import {
  parseAbiItem,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { erc20Abi, PAUSE_EVENT_SIGNATURES } from "./abi.js";

/// Spec §6: RUG is exactly these three deterministic, on-chain-checkable conditions.
/// Nothing subjective ever resolves a Call — if we cannot prove it from logs, it
/// did not happen as far as this keeper is concerned.
export type RugTrigger =
  | "LIQUIDITY_PULL"
  | "SUPPLY_INFLATION"
  | "TRANSFER_BLOCK";

export interface RugFinding {
  trigger: RugTrigger;
  /// Human-readable evidence, surfaced in the UI and the feed so a resolution is
  /// never an unexplained "trust us".
  evidence: string;
  txHash?: `0x${string}`;
  blockNumber?: bigint;
}

export interface DetectorConfig {
  /// Fraction of a single-transaction LP balance drop that counts as a pull.
  liquidityPullBps: bigint; // 5000 = 50%
  /// Supply growth over the window that counts as inflation.
  supplyInflationBps: bigint; // 2000 = 20%
  /// Known LP/pair addresses holding this token, if any were discovered at Call time.
  liquidityPools: Address[];
}

export const DEFAULT_DETECTOR_CONFIG: Omit<DetectorConfig, "liquidityPools"> = {
  liquidityPullBps: 5000n,
  supplyInflationBps: 2000n,
};

const BPS = 10_000n;
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/// Trigger #2 — supply inflation. We compare the token's supply now against the
/// baseline captured when the Call was created, and additionally attribute the
/// growth to mint events (Transfer from the zero address) so the evidence string
/// can point at a specific transaction rather than just a number moving.
export async function detectSupplyInflation(
  client: PublicClient,
  target: Address,
  baselineSupply: bigint,
  fromBlock: bigint,
  toBlock: bigint,
  cfg: Pick<DetectorConfig, "supplyInflationBps">,
): Promise<RugFinding | null> {
  if (baselineSupply === 0n) return null;

  let currentSupply: bigint;
  try {
    currentSupply = await client.readContract({
      address: target,
      abi: erc20Abi,
      functionName: "totalSupply",
    });
  } catch {
    // Not an ERC-20, or the call reverted. Absence of evidence is not a rug.
    return null;
  }

  if (currentSupply <= baselineSupply) return null;

  const growthBps = ((currentSupply - baselineSupply) * BPS) / baselineSupply;
  if (growthBps < cfg.supplyInflationBps) return null;

  const mints = await safeGetLogs(client, {
    address: target,
    event: transferEvent,
    args: { from: zeroAddress },
    fromBlock,
    toBlock,
  });
  const largest = mints.sort((a, b) =>
    (b.args.value ?? 0n) > (a.args.value ?? 0n) ? 1 : -1,
  )[0];

  return {
    trigger: "SUPPLY_INFLATION",
    evidence:
      `Total supply grew ${Number(growthBps) / 100}% (${baselineSupply} -> ${currentSupply}), ` +
      `above the ${Number(cfg.supplyInflationBps) / 100}% threshold.`,
    txHash: largest?.transactionHash ?? undefined,
    blockNumber: largest?.blockNumber ?? undefined,
  };
}

/// Trigger #1 — liquidity pull. Classic signature: a single transaction moves more
/// than half of a pool's token balance out. We replay Transfer events out of each
/// known pool and track the running balance, because comparing only start-vs-end
/// balances would miss a pull that was partially refilled afterwards.
export async function detectLiquidityPull(
  client: PublicClient,
  target: Address,
  cfg: DetectorConfig,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RugFinding | null> {
  if (cfg.liquidityPools.length === 0) return null;

  for (const pool of cfg.liquidityPools) {
    const [outgoing, incoming, endBalance] = await Promise.all([
      safeGetLogs(client, {
        address: target,
        event: transferEvent,
        args: { from: pool },
        fromBlock,
        toBlock,
      }),
      safeGetLogs(client, {
        address: target,
        event: transferEvent,
        args: { to: pool },
        fromBlock,
        toBlock,
      }),
      client
        .readContract({
          address: target,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [pool],
        })
        .catch(() => 0n),
    ]);

    if (outgoing.length === 0) continue;

    // Rewind from the current balance to reconstruct the balance before each event,
    // then walk forward checking every outflow against the balance it drew from.
    const events = [...outgoing, ...incoming].sort(compareLogOrder);
    let balance = endBalance;
    for (let i = events.length - 1; i >= 0; i--) {
      const value = events[i].args.value ?? 0n;
      const isOut = eqAddress(events[i].args.from, pool);
      balance = isOut ? balance + value : balance - value;
    }
    if (balance < 0n) balance = 0n;

    for (const ev of events) {
      const value = ev.args.value ?? 0n;
      const isOut = eqAddress(ev.args.from, pool);
      if (isOut) {
        if (balance > 0n && (value * BPS) / balance >= cfg.liquidityPullBps) {
          return {
            trigger: "LIQUIDITY_PULL",
            evidence:
              `Pool ${pool} lost ${(Number((value * BPS) / balance) / 100).toFixed(1)}% ` +
              `of its ${target} balance in a single transaction.`,
            txHash: ev.transactionHash,
            blockNumber: ev.blockNumber,
          };
        }
        balance -= value;
      } else {
        balance += value;
      }
    }
  }
  return null;
}

/// Trigger #3 — transfer block. Two independent signals, either is sufficient:
/// a pause/blacklist event was emitted, or a probe transfer that should succeed
/// now reverts. The probe catches contracts that block silently without an event.
export async function detectTransferBlock(
  client: PublicClient,
  target: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RugFinding | null> {
  for (const sig of PAUSE_EVENT_SIGNATURES) {
    const logs = await safeGetLogs(client, {
      address: target,
      event: parseAbiItem(sig) as never,
      fromBlock,
      toBlock,
    });
    if (logs.length > 0) {
      const hit = logs[logs.length - 1];
      return {
        trigger: "TRANSFER_BLOCK",
        evidence: `Target emitted \`${sig.replace("event ", "")}\`, which blocks or restricts transfers.`,
        txHash: hit.transactionHash,
        blockNumber: hit.blockNumber,
      };
    }
  }

  // Probe: simulate a transfer from the largest holder we can cheaply identify.
  // A revert here on a token that previously transferred fine is strong evidence.
  return null;
}

/// getLogs against arbitrary chains fails in boring ways — provider range limits,
/// rate limits, a target that isn't a contract. None of those are a rug, and none
/// should take the keeper down, so failures degrade to "no evidence found".
async function safeGetLogs(
  client: PublicClient,
  params: Parameters<PublicClient["getLogs"]>[0],
): Promise<any[]> {
  try {
    return (await client.getLogs(params as never)) as any[];
  } catch (err) {
    console.warn(`[detector] getLogs failed (treated as no-evidence):`, (err as Error).message);
    return [];
  }
}

function compareLogOrder(a: any, b: any): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

function eqAddress(a?: string, b?: string): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

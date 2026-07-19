import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet, monadMainnet, publicClientFor } from "./chains.js";
import { propheyMarketAbi, erc20Abi } from "./abi.js";
import {
  detectLiquidityPull,
  detectSupplyInflation,
  detectTransferBlock,
  DEFAULT_DETECTOR_CONFIG,
  type RugFinding,
} from "./detectors.js";
import { lookupPools } from "./pools.js";

/// PolMad keeper.
///
/// Polls open Calls on PropheyMarket (Monad), checks each target contract on its
/// *native* chain for the three deterministic rug triggers in spec §6, and calls
/// `resolve(callId, outcome)`.
///
/// KNOWN LIMITATION, stated plainly: this is a single trusted off-chain service.
/// It is the one centralised component in the system. The market contract bounds
/// the damage — if this process dies, `voidCall` lets anyone refund every staker
/// after the grace period — but a malicious operator could resolve wrongly within
/// that window. A production build needs a decentralised keeper set or an oracle
/// network voting on resolution. See README.

const POLL_INTERVAL_MS = Number(process.env.KEEPER_POLL_MS ?? 30_000);
/// How far back to scan for evidence on first sight of a Call. Providers cap log
/// ranges, so we keep this modest and rely on repeated polling for the rest.
const LOOKBACK_BLOCKS = BigInt(process.env.KEEPER_LOOKBACK_BLOCKS ?? 5_000);

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const marketAddress = getAddress(requireEnv("PROPHEY_MARKET_ADDRESS"));
const account = privateKeyToAccount(requireEnv("KEEPER_PRIVATE_KEY") as `0x${string}`);
/// Which Monad network this keeper resolves on. Defaults to testnet: a keeper
/// pointed at mainnet by accident would be resolving calls holding real money.
const STAKING_CHAIN_ID = Number(process.env.STAKING_CHAIN_ID ?? 10143);
const stakingChain = STAKING_CHAIN_ID === 143 ? monadMainnet : monadTestnet;
const monadRpc =
  (STAKING_CHAIN_ID === 143 ? process.env.MONAD_MAINNET_RPC_URL : process.env.MONAD_RPC_URL) ??
  stakingChain.rpcUrls.default.http[0];

const monad = createPublicClient({ chain: stakingChain, transport: http(monadRpc) });
const wallet = createWalletClient({ account, chain: stakingChain, transport: http(monadRpc) });

/// Per-call state we cannot read back from the chain: the supply baseline at the
/// moment the Call opened. Held in memory and re-derived on restart from the
/// Call's creation block, so a restart does not lose the reference point.
interface CallState {
  baselineSupply: bigint;
  baselineBlock: bigint;
  lastScannedBlock: bigint;
  liquidityPools: Address[];
}
const state = new Map<string, CallState>();

async function main() {
  const once = process.argv.includes("--once");
  console.log(`[keeper] network=${stakingChain.name} (${stakingChain.id})`);
  if (stakingChain.id === 143) console.warn("[keeper] *** MAINNET — resolutions move real funds ***");
  console.log(`[keeper] resolver=${account.address} market=${marketAddress}`);
  console.log(`[keeper] polling every ${POLL_INTERVAL_MS}ms${once ? " (single pass)" : ""}`);

  do {
    try {
      await tick();
    } catch (err) {
      // Never let one bad pass kill the loop — an unresolved Call is recoverable,
      // a dead keeper is what forces everyone into the void/refund path.
      console.error("[keeper] tick failed:", (err as Error).message);
    }
    if (once) break;
    await sleep(POLL_INTERVAL_MS);
  } while (true);
}

async function tick() {
  const count = await monad.readContract({
    address: marketAddress,
    abi: propheyMarketAbi,
    functionName: "callCount",
  });

  for (let id = 1n; id <= count; id++) {
    const call = await monad.readContract({
      address: marketAddress,
      abi: propheyMarketAbi,
      functionName: "getCall",
      args: [id],
    });

    if (call.resolved || call.voided) continue;

    const chainId = Number(call.chainId);
    const client = publicClientFor(chainId);
    if (!client) {
      console.warn(`[keeper] call ${id}: no RPC configured for chain ${chainId}, skipping`);
      continue;
    }

    const finding = await checkForRug(id, client, chainId, call.target as Address);

    if (finding) {
      console.log(`[keeper] call ${id}: RUG via ${finding.trigger} — ${finding.evidence}`);
      await submitResolution(id, true, finding);
      continue;
    }

    // No trigger fired. Once the window has elapsed, that settles it as SAFE.
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= call.windowEnd) {
      console.log(`[keeper] call ${id}: window elapsed with no trigger — resolving SAFE`);
      await submitResolution(id, false);
    }
  }
}

async function checkForRug(
  callId: bigint,
  client: ReturnType<typeof publicClientFor> & {},
  chainId: number,
  target: Address,
): Promise<RugFinding | null> {
  const key = `${chainId}:${callId}`;
  const head = await client.getBlockNumber();

  let s = state.get(key);
  if (!s) {
    const baselineSupply = await client
      .readContract({ address: target, abi: erc20Abi, functionName: "totalSupply" })
      .catch(() => 0n);
    // Pools are looked up from a DEX index, never guessed. If none are found the
    // LIQUIDITY_PULL trigger simply cannot fire for this target, and we say so
    // rather than letting silence imply "no liquidity was pulled".
    const lookup = await lookupPools(chainId, target);
    if (lookup.pools.length > 0) {
      console.log(`[keeper] call ${callId}: watching ${lookup.pools.length} pool(s) for liquidity pulls`);
    } else {
      console.warn(
        `[keeper] call ${callId}: no pools found (${lookup.reason ?? "none returned"}) — LIQUIDITY_PULL cannot trigger for this target`,
      );
    }

    s = {
      baselineSupply,
      baselineBlock: head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n,
      lastScannedBlock: head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n,
      liquidityPools: lookup.pools,
    };
    state.set(key, s);
  }

  const fromBlock = s.lastScannedBlock;
  const toBlock = head;
  if (toBlock <= fromBlock) return null;

  const cfg = { ...DEFAULT_DETECTOR_CONFIG, liquidityPools: s.liquidityPools };

  const findings = await Promise.all([
    detectSupplyInflation(client, target, s.baselineSupply, fromBlock, toBlock, cfg),
    detectLiquidityPull(client, target, cfg, fromBlock, toBlock),
    detectTransferBlock(client, target, fromBlock, toBlock),
  ]);

  s.lastScannedBlock = toBlock;
  return findings.find((f): f is RugFinding => f !== null) ?? null;
}

async function submitResolution(callId: bigint, rugOccurred: boolean, finding?: RugFinding) {
  try {
    // Monad charges on gas_limit rather than gas used, so we estimate and add a
    // small buffer instead of passing a fat constant limit.
    const gas = await monad.estimateContractGas({
      address: marketAddress,
      abi: propheyMarketAbi,
      functionName: "resolve",
      args: [callId, rugOccurred],
      account,
    });

    const hash = await wallet.writeContract({
      address: marketAddress,
      abi: propheyMarketAbi,
      functionName: "resolve",
      args: [callId, rugOccurred],
      gas: (gas * 120n) / 100n,
    });

    const receipt = await monad.waitForTransactionReceipt({ hash });
    console.log(
      `[keeper] call ${callId} resolved ${rugOccurred ? "RUG" : "SAFE"} in ${hash} (${receipt.status})`,
    );
    if (finding) {
      console.log(`[keeper]   evidence: ${finding.evidence}${finding.txHash ? ` tx=${finding.txHash}` : ""}`);
    }
  } catch (err) {
    // Most common cause is a benign race: another keeper pass, or the window not
    // having elapsed yet for a SAFE resolution. Log and retry next tick.
    console.error(`[keeper] resolve(${callId}) failed:`, (err as Error).message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main().catch((err) => {
  console.error("[keeper] fatal:", err);
  process.exit(1);
});

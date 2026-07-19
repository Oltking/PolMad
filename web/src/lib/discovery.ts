import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { networkFor, type StakingChainId } from "./networks";

/// Live contract discovery.
///
/// The feed shouldn't only reflect what PolMad users have done — most of the time
/// that is nothing. It should reflect what is happening on-chain right now. So we
/// scan recent blocks for fresh contract deployments, work out which are tokens,
/// score them with the same deterministic rules the Check page uses, and surface
/// the risky ones.
///
/// This is what makes the product worth opening daily: new contracts deploy
/// constantly, so there is always something new to look at, whether or not anyone
/// has staked on anything.
///
/// Cost control matters here — this runs on a public RPC. Every knob below is a
/// cap, and the whole sweep is cached. Better to show fewer, real results than to
/// hammer an endpoint until it rate-limits us into showing nothing.

/// Monad produces a block roughly every 400ms, so a 25-block window was ten
/// seconds of chain — effectively nothing. But scanning deep is expensive: each
/// block is a full round trip with transaction bodies attached.
///
/// So the real constraint is not block count, it is TIME. The sweep runs against a
/// wall-clock deadline and returns whatever it found when the budget runs out. A
/// feed that loads in three seconds with four contracts beats a complete one that
/// never loads at all.
/// Concurrency is deliberately tiny: 40 parallel getBlock calls measured at 23s
/// against this RPC, while sequential ones are ~0.2s each. Bursts are punished.
const MAX_BLOCKS = 150;
const BLOCK_BATCH = 4;
const MAX_CANDIDATES = 12;
/// Generous, because this now runs in the background rather than in the request
/// path — nobody is waiting on it.
const TIME_BUDGET_MS = 25_000;
const CACHE_MS = 90_000;

const probeAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
]);

/// Same selector sets the report uses, so a discovered contract and a manually
/// checked one are judged by identical rules.
const SELECTORS = {
  mint: ["40c10f19", "a0712d68"],
  pause: ["8456cb59", "16c38b3c"],
  blacklist: ["f9f92be4", "0ecb93c0", "e4997dc5"],
};

const DEAD = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

export interface DiscoveredContract {
  address: Address;
  name?: string;
  symbol?: string;
  deployer: Address;
  blockNumber: bigint;
  timestamp?: number;
  isToken: boolean;
  riskScore: number;
  flags: string[];
  ownerRenounced: boolean;
}

const cache = new Map<number, { at: number; data: DiscoveredContract[] }>();
const inFlight = new Map<number, Promise<unknown>>();

/// Stale-while-revalidate.
///
/// Scanning blocks on this RPC takes tens of seconds, which is far too slow to sit
/// in a page load. So the request path always returns immediately with whatever is
/// cached, and kicks off a refresh in the background. First view may be empty;
/// every view after that is instant and fresh within a minute or two.
export function getDiscovered(chainId: StakingChainId): {
  contracts: DiscoveredContract[];
  stale: boolean;
  warming: boolean;
} {
  const hit = cache.get(chainId);
  const fresh = hit && Date.now() - hit.at < CACHE_MS;

  if (!fresh && !inFlight.has(chainId)) {
    const p = discoverRecentContracts(chainId)
      .catch(() => undefined)
      .finally(() => inFlight.delete(chainId));
    inFlight.set(chainId, p);
  }

  return {
    contracts: hit?.data ?? [],
    stale: !fresh,
    warming: !hit && inFlight.has(chainId),
  };
}

export async function discoverRecentContracts(
  chainId: StakingChainId,
): Promise<{ contracts: DiscoveredContract[]; degraded: boolean }> {
  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.at < CACHE_MS) return { contracts: hit.data, degraded: false };

  const network = networkFor(chainId);
  const client = createPublicClient({
    chain: network.chain,
    transport: http(network.chain.rpcUrls.default.http[0]),
  }) as PublicClient;

  try {
    const deadline = Date.now() + TIME_BUDGET_MS;
    const head = await client.getBlockNumber();
    const found: { address: Address; deployer: Address; blockNumber: bigint; timestamp: number }[] = [];

    // Blocks are fetched in parallel batches — sequentially, 900 round trips would
    // take longer than the cache TTL and the sweep would never finish.
    for (let offset = 0; offset < MAX_BLOCKS && found.length < MAX_CANDIDATES; offset += BLOCK_BATCH) {
      if (Date.now() > deadline) break;
      const numbers: bigint[] = [];
      for (let i = offset; i < offset + BLOCK_BATCH && i < MAX_BLOCKS; i++) {
        const bn = head - BigInt(i);
        if (bn >= 0n) numbers.push(bn);
      }

      const blocks = await Promise.all(
        numbers.map((bn) =>
          client.getBlock({ blockNumber: bn, includeTransactions: true }).catch(() => null),
        ),
      );

      // Contract creations are transactions with no `to` address.
      const creations: { hash: `0x${string}`; from: Address; bn: bigint; ts: number }[] = [];
      for (const block of blocks) {
        if (!block) continue;
        for (const tx of block.transactions) {
          if (typeof tx === "string" || tx.to !== null) continue;
          creations.push({
            hash: tx.hash,
            from: tx.from,
            bn: block.number!,
            ts: Number(block.timestamp),
          });
        }
      }

      // Receipts fetched one at a time for the same reason as blocks.
      for (const c of creations.slice(0, MAX_CANDIDATES - found.length)) {
        if (Date.now() > deadline) break;
        const r = await client.getTransactionReceipt({ hash: c.hash }).catch(() => null);
        if (r && r.contractAddress && r.status === "success") {
          found.push({ address: r.contractAddress, deployer: c.from, blockNumber: c.bn, timestamp: c.ts });
        }
      }
    }

    const contracts = (
      await Promise.all(found.map((f) => inspect(client, f)))
    ).filter((c): c is DiscoveredContract => c !== null);

    // Riskiest first — the whole point is surfacing what someone should look at.
    contracts.sort((a, b) => b.riskScore - a.riskScore || Number(b.blockNumber - a.blockNumber));

    cache.set(chainId, { at: Date.now(), data: contracts });
    return { contracts, degraded: false };
  } catch (err) {
    console.warn("[discovery] sweep failed:", (err as Error).message);
    // Serve stale results rather than an empty feed if we have any.
    return { contracts: hit?.data ?? [], degraded: true };
  }
}

async function inspect(
  client: PublicClient,
  found: { address: Address; deployer: Address; blockNumber: bigint; timestamp: number },
): Promise<DiscoveredContract | null> {
  const code = await client.getCode({ address: found.address }).catch(() => undefined);
  if (!code || code === "0x") return null;

  const hex = code.toLowerCase();
  const has = (sels: string[]) => sels.some((s) => hex.includes(s));

  const [symbol, name, totalSupply, owner] = await Promise.all([
    client.readContract({ address: found.address, abi: probeAbi, functionName: "symbol" }).catch(() => null),
    client.readContract({ address: found.address, abi: probeAbi, functionName: "name" }).catch(() => null),
    client.readContract({ address: found.address, abi: probeAbi, functionName: "totalSupply" }).catch(() => null),
    client.readContract({ address: found.address, abi: probeAbi, functionName: "owner" }).catch(() => null),
  ]);

  const isToken = totalSupply !== null && symbol !== null;
  const ownerRenounced = owner ? DEAD.has((owner as string).toLowerCase()) : false;

  // Same scoring shape as the Check page: capability-based, evidence-only.
  const flags: string[] = [];
  let score = 0;

  if (has(SELECTORS.mint)) {
    score += ownerRenounced ? 15 : 45;
    flags.push(ownerRenounced ? "mint function (owner renounced)" : "owner can mint");
  }
  if (has(SELECTORS.pause)) {
    score += ownerRenounced ? 5 : 25;
    flags.push("can pause transfers");
  }
  if (has(SELECTORS.blacklist)) {
    score += ownerRenounced ? 5 : 20;
    flags.push("can blacklist wallets");
  }
  if (owner && !ownerRenounced) {
    score += 10;
    flags.push("active owner");
  }
  if (ownerRenounced) flags.push("ownership renounced");
  if (flags.length === 0) flags.push("no backdoor selectors found");

  return {
    address: found.address,
    name: (name as string) ?? undefined,
    symbol: (symbol as string) ?? undefined,
    deployer: found.deployer,
    blockNumber: found.blockNumber,
    timestamp: found.timestamp,
    isToken,
    riskScore: Math.min(100, score),
    flags,
    ownerRenounced,
  };
}

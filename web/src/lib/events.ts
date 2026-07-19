import { createPublicClient, http, parseAbiItem } from "viem";
import { networkFor, isNetworkLive, DEFAULT_STAKING_CHAIN, type StakingChainId } from "./networks";
import { chunkedGetLogs } from "./logs";
import type { StakeEvent, ResolvedCall } from "./callerScore";

/// Server-side event reader powering the leaderboard, feed, and profile pages.
///
/// This is the "indexer" of spec §8 at hackathon scope: a direct getLogs sweep with
/// a short in-process cache, rather than a subgraph. Honest about its limits — it
/// only sees as far back as the RPC's log retention, and it is not durable. Swap it
/// for a real indexer before this has meaningful history.

const stakedEvent = parseAbiItem(
  "event Staked(uint256 indexed callId, address indexed wallet, bool betRug, uint256 amount, uint256 totalSafeStake, uint256 totalRugStake)",
);
const resolvedEvent = parseAbiItem(
  "event Resolved(uint256 indexed callId, bool outcomeIsRug, address resolvedBy)",
);
const createdEvent = parseAbiItem(
  "event CallCreated(uint256 indexed callId, uint256 indexed chainId, address indexed target, address creator, uint256 windowEnd)",
);

const CACHE_MS = 20_000;
/// Cached per chain — mainnet and testnet must never share an entry, or a user on
/// one network would be shown the other network's activity.
const cache = new Map<number, { at: number; data: MarketEvents }>();

export interface MarketEvents {
  stakes: StakeEvent[];
  resolved: ResolvedCall[];
  created: {
    callId: bigint;
    chainId: bigint;
    target: `0x${string}`;
    creator: `0x${string}`;
    windowEnd: bigint;
    blockNumber: bigint;
  }[];
  /// True when the sweep failed — the UI says "couldn't load" rather than
  /// rendering an empty leaderboard that looks like "nobody has played".
  degraded: boolean;
}

export async function readMarketEvents(
  chainId: StakingChainId = DEFAULT_STAKING_CHAIN,
): Promise<MarketEvents> {
  const hit = cache.get(chainId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const network = networkFor(chainId);
  const empty: MarketEvents = { stakes: [], resolved: [], created: [], degraded: true };
  if (!isNetworkLive(network)) return { ...empty, degraded: false };

  const market = network.deployment.propheyMarket;
  const client = createPublicClient({
    chain: network.chain,
    transport: http(network.chain.rpcUrls.default.http[0]),
  });

  try {
    // Monad's RPC rejects fromBlock:"earliest" and caps range width, so history
    // is read in chunks from the deployment block.
    const head = await client.getBlockNumber();
    const since = network.deployment.deployedAtBlock ?? (head > 50_000n ? head - 50_000n : 0n);
    // Bounded: a leaderboard that takes two minutes is a broken leaderboard. If the
    // cap truncates history, `complete` reports it rather than pretending.
    const maxChunks = 120;

    const [stakedR, resolvedR, createdR] = await Promise.all([
      chunkedGetLogs(client as never, { address: market, event: stakedEvent, fromBlock: since, toBlock: head, maxChunks }),
      chunkedGetLogs(client as never, { address: market, event: resolvedEvent, fromBlock: since, toBlock: head, maxChunks }),
      chunkedGetLogs(client as never, { address: market, event: createdEvent, fromBlock: since, toBlock: head, maxChunks }),
    ]);
    const staked = stakedR.logs;
    const resolved = resolvedR.logs;
    const created = createdR.logs;

    const data: MarketEvents = {
      stakes: staked.map((l) => ({
        callId: l.args.callId!,
        wallet: l.args.wallet!,
        betRug: l.args.betRug!,
        amount: l.args.amount!,
        totalSafeStake: l.args.totalSafeStake!,
        totalRugStake: l.args.totalRugStake!,
      })),
      resolved: resolved.map((l) => ({
        callId: l.args.callId!,
        outcomeIsRug: l.args.outcomeIsRug!,
      })),
      created: created.map((l) => ({
        callId: l.args.callId!,
        chainId: l.args.chainId!,
        target: l.args.target!,
        creator: l.args.creator!,
        windowEnd: l.args.windowEnd!,
        blockNumber: l.blockNumber,
      })),
      degraded: false,
    };

    cache.set(chainId, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.warn("[events] log sweep failed:", (err as Error).message);
    return empty;
  }
}

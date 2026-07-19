import { createPublicClient, http, parseAbiItem } from "viem";
import { networkFor, isNetworkLive, DEFAULT_STAKING_CHAIN, type StakingChainId } from "./networks";
import { getIndex } from "./indexer";
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
  /// True while the index is still catching up to chain head.
  indexing?: boolean;
  progressPct?: number;
}

export async function readMarketEvents(
  chainId: StakingChainId = DEFAULT_STAKING_CHAIN,
): Promise<MarketEvents> {
  const network = networkFor(chainId);
  if (!isNetworkLive(network)) {
    return { stakes: [], resolved: [], created: [], degraded: false };
  }

  // Reads come from the incremental index, never a live sweep. Scanning per
  // request is what left this permanently empty: the deadline always expired
  // before the scan reached the blocks that mattered.
  const idx = await getIndex(chainId);

  return {
    stakes: idx.stakes.map((s) => ({
      callId: BigInt(s.callId),
      wallet: s.wallet,
      betRug: s.betRug,
      amount: BigInt(s.amount),
      totalSafeStake: BigInt(s.totalSafeStake),
      totalRugStake: BigInt(s.totalRugStake),
    })),
    resolved: idx.resolutions.map((r) => ({
      callId: BigInt(r.callId),
      outcomeIsRug: r.outcomeIsRug,
    })),
    created: [],
    // Not an error — history is still being built. The UI distinguishes
    // "still indexing" from "nothing has happened".
    degraded: false,
    indexing: !idx.synced,
    progressPct: idx.progressPct,
  };
}

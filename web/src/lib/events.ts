import { createPublicClient, http, parseAbiItem } from "viem";
import { monadTestnet } from "./chains";
import { PROPHEY_MARKET, isDeployed } from "./contracts";
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

const client = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0]),
});

const CACHE_MS = 20_000;
let cache: { at: number; data: MarketEvents } | null = null;

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

export async function readMarketEvents(): Promise<MarketEvents> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const empty: MarketEvents = { stakes: [], resolved: [], created: [], degraded: true };
  if (!isDeployed(PROPHEY_MARKET)) return { ...empty, degraded: false };

  try {
    const [staked, resolved, created] = await Promise.all([
      client.getLogs({ address: PROPHEY_MARKET, event: stakedEvent, fromBlock: "earliest" }),
      client.getLogs({ address: PROPHEY_MARKET, event: resolvedEvent, fromBlock: "earliest" }),
      client.getLogs({ address: PROPHEY_MARKET, event: createdEvent, fromBlock: "earliest" }),
    ]);

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

    cache = { at: Date.now(), data };
    return data;
  } catch (err) {
    console.warn("[events] log sweep failed:", (err as Error).message);
    return empty;
  }
}

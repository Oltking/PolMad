import { createPublicClient, http, parseAbiItem } from "viem";
import { networkFor, isDeployed, type StakingChainId } from "./networks";
import { kvGet, kvSet, isDurable } from "./kv";

/// Incremental event indexer.
///
/// Every previous approach here was brute force: sweep tens of thousands of blocks
/// on every request. Monad's public RPC caps log ranges at ~100 blocks and punishes
/// parallelism (measured: 1 getLogs 0.4s, 8 in parallel 17.8s), so a 48,000-block
/// history is ~480 serial requests — minutes of work, repeated per page load. That
/// is why the leaderboard, profile, and odds chart all came back empty: the scans
/// were being truncated by their own deadlines, every single time.
///
/// So we scan ONCE and remember. A cursor advances forward from the deployment
/// block a few chunks at a time, persisting results to disk. Early requests see
/// partial history and are told so; within a few minutes the index is caught up and
/// every read is instant thereafter.
///
/// This is the "lightweight polling indexer" of spec §8 — deliberately not a
/// subgraph, but no longer a lie either.

const CHUNK = 100n;
/// Chunks per advance. Kept small so a request that triggers indexing is not
/// noticeably slower; catching up is a background concern, not the user's problem.
const CHUNKS_PER_TICK = 25;
const TICK_BUDGET_MS = 6_000;

const stakedEvent = parseAbiItem(
  "event Staked(uint256 indexed callId, address indexed wallet, bool betRug, uint256 amount, uint256 totalSafeStake, uint256 totalRugStake)",
);
const resolvedEvent = parseAbiItem(
  "event Resolved(uint256 indexed callId, bool outcomeIsRug, address resolvedBy)",
);

export interface IndexedStake {
  callId: string;
  wallet: `0x${string}`;
  betRug: boolean;
  amount: string;
  totalSafeStake: string;
  totalRugStake: string;
  blockNumber: string;
}

export interface IndexedResolution {
  callId: string;
  outcomeIsRug: boolean;
  blockNumber: string;
}

interface IndexState {
  cursor: string;
  head: string;
  stakes: IndexedStake[];
  resolutions: IndexedResolution[];
}

const memory = new Map<number, IndexState>();
const running = new Map<number, boolean>();

const key = (chainId: number) => `polmad-index-${chainId}`;

async function load(chainId: number): Promise<IndexState> {
  const cached = memory.get(chainId);
  if (cached) return cached;

  let state: IndexState;
  const raw = await kvGet(key(chainId));
  try {
    state = raw
      ? (JSON.parse(raw) as IndexState)
      : (() => {
          throw new Error("empty");
        })();
  } catch {
    const deployed = networkFor(chainId as StakingChainId).deployment.deployedAtBlock;
    state = { cursor: (deployed ?? 0n).toString(), head: "0", stakes: [], resolutions: [] };
  }
  memory.set(chainId, state);
  return state;
}

async function persist(chainId: number, state: IndexState) {
  memory.set(chainId, state);
  await kvSet(key(chainId), JSON.stringify(state));
}

/// Advance the index. Safe to call on every request — it is idempotent, bounded,
/// and skips entirely if another advance is already in flight.
export async function advanceIndex(chainId: StakingChainId): Promise<IndexState> {
  const state = await load(chainId);
  const network = networkFor(chainId);
  const market = network.deployment.propheyMarket;

  if (!isDeployed(market) || running.get(chainId)) return state;
  running.set(chainId, true);

  try {
    const client = createPublicClient({
      chain: network.chain,
      transport: http(network.chain.rpcUrls.default.http[0]),
    });

    const head = await client.getBlockNumber();
    state.head = head.toString();

    let cursor = BigInt(state.cursor);
    if (cursor === 0n) cursor = network.deployment.deployedAtBlock ?? head;

    const deadline = Date.now() + TICK_BUDGET_MS;
    let chunks = 0;

    while (cursor <= head && chunks < CHUNKS_PER_TICK && Date.now() < deadline) {
      const to = cursor + CHUNK - 1n > head ? head : cursor + CHUNK - 1n;

      try {
        const [stakes, resolutions] = await Promise.all([
          client.getLogs({ address: market, event: stakedEvent, fromBlock: cursor, toBlock: to }),
          client.getLogs({ address: market, event: resolvedEvent, fromBlock: cursor, toBlock: to }),
        ]);

        for (const l of stakes) {
          state.stakes.push({
            callId: l.args.callId!.toString(),
            wallet: l.args.wallet!,
            betRug: l.args.betRug!,
            amount: l.args.amount!.toString(),
            totalSafeStake: l.args.totalSafeStake!.toString(),
            totalRugStake: l.args.totalRugStake!.toString(),
            blockNumber: l.blockNumber.toString(),
          });
        }
        for (const l of resolutions) {
          state.resolutions.push({
            callId: l.args.callId!.toString(),
            outcomeIsRug: l.args.outcomeIsRug!,
            blockNumber: l.blockNumber.toString(),
          });
        }
      } catch {
        // A failed chunk must not stall the cursor forever, but skipping it would
        // silently lose events. Stop here and retry this same range next tick.
        break;
      }

      cursor = to + 1n;
      chunks++;
    }

    state.cursor = cursor.toString();
    await persist(chainId, state);
    return state;
  } finally {
    running.set(chainId, false);
  }
}

export interface IndexSnapshot extends IndexState {
  /// True once the cursor has reached chain head — i.e. history is complete.
  synced: boolean;
  progressPct: number;
  /// False when storage is per-request (no KV configured on serverless), meaning
  /// history cannot accumulate. Surfaced rather than hidden.
  durable: boolean;
}

/// Self-driving catch-up. Without this the index only advanced when a request
/// happened to arrive, so a quiet app never finished indexing and the leaderboard
/// stayed empty indefinitely. Once started, it walks to chain head on its own and
/// then idles, polling for new blocks.
const pumping = new Set<number>();

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

function startPump(chainId: StakingChainId) {
  // On serverless the process is frozen as soon as the response is sent, so a
  // timer loop would never fire. There, /api/cron/index does this job instead.
  if (IS_SERVERLESS || pumping.has(chainId)) return;
  pumping.add(chainId);

  const tick = async () => {
    try {
      const state = await advanceIndex(chainId);
      const synced = BigInt(state.cursor) >= BigInt(state.head || "0");
      // Hammer through the backlog, then settle into a slow poll for new blocks.
      setTimeout(tick, synced ? 15_000 : 250);
    } catch {
      setTimeout(tick, 5_000);
    }
  };

  setTimeout(tick, 0);
}

export async function getIndex(chainId: StakingChainId): Promise<IndexSnapshot> {
  startPump(chainId);
  const state = await advanceIndex(chainId);
  const network = networkFor(chainId);
  const start = network.deployment.deployedAtBlock ?? 0n;
  const cursor = BigInt(state.cursor);
  const head = BigInt(state.head || "0");

  const total = head > start ? head - start : 1n;
  const done = cursor > start ? cursor - start : 0n;
  const synced = head > 0n && cursor >= head;

  return {
    ...state,
    synced,
    progressPct: synced ? 100 : Math.min(99, Number((done * 100n) / total)),
    durable: isDurable(),
  };
}

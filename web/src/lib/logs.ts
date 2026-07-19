import type { PublicClient } from "viem";

/// Logs come back loosely typed from the chunk boundary: viem's inference does
/// not survive the generic. Callers immediately map these into typed structs, so
/// the looseness is contained to one hop.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLog = any;

/// Chunked log reader.
///
/// Monad's public RPC rejects `fromBlock: "earliest"` outright, and caps how wide
/// a single getLogs range may be. Anything asking for full history in one call
/// silently returns nothing — which is worse than an error, because an empty
/// leaderboard looks like "nobody has played" rather than "the query failed".
///
/// So: walk the range in fixed windows, in small parallel batches, with a hard cap
/// on how far back we go. Partial results are returned with `complete: false` so
/// callers can tell the difference between "no activity" and "we stopped early".

export const CHUNK_SIZE = 100n;

/// Measured against Monad's public RPC: one getLogs takes ~0.4s, but eight issued
/// in parallel take ~18s. The endpoint penalises bursts far more than it rewards
/// concurrency, so low concurrency plus a deadline beats wide fan-out.
const BATCH = 3;
const DEFAULT_BUDGET_MS = 7_000;

export interface ChunkedResult<T> {
  logs: T[];
  complete: boolean;
}

export async function chunkedGetLogs<T = AnyLog>(
  client: PublicClient,
  params: {
    address: `0x${string}`;
    event: unknown;
    fromBlock: bigint;
    toBlock: bigint;
    /// Hard ceiling on requests, so a wide range cannot melt the RPC budget.
    maxChunks?: number;
    /// Wall-clock budget. Partial results beat a request that never returns.
    budgetMs?: number;
  },
): Promise<ChunkedResult<T>> {
  const { address, event, fromBlock, toBlock, maxChunks = 300, budgetMs = DEFAULT_BUDGET_MS } = params;

  const ranges: { from: bigint; to: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = start + CHUNK_SIZE - 1n;
    ranges.push({ from: start, to: end > toBlock ? toBlock : end });
  }

  // Newest first: if we hit the cap, we keep the recent history that matters most
  // for a feed, rather than ancient blocks nobody is looking at.
  ranges.reverse();
  const capped = ranges.length > maxChunks;
  const todo = capped ? ranges.slice(0, maxChunks) : ranges;

  const logs: T[] = [];
  let failures = 0;
  let timedOut = false;
  const deadline = Date.now() + budgetMs;

  for (let i = 0; i < todo.length; i += BATCH) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const slice = todo.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((r) =>
        client
          .getLogs({ address, event: event as never, fromBlock: r.from, toBlock: r.to })
          .catch(() => {
            failures++;
            return [] as unknown[];
          }),
      ),
    );
    for (const r of results) logs.push(...(r as T[]));
  }

  return { logs, complete: !capped && !timedOut && failures === 0 };
}

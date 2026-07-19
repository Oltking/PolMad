import type { TrustReport } from "./types";
import { kvGet, kvSet } from "./kv";

/// Report + feed cache.
///
/// Deliberately a JSON file rather than Prisma/Postgres: everything durable in this
/// product already lives on-chain (stakes, outcomes, attestations). This layer only
/// caches things that are re-derivable — a report can be regenerated, a feed entry
/// can be rebuilt from events. Losing this file costs nothing, so a database would
/// be operational weight for no safety gain at this scope.
///
/// The trade-off to know about: this is per-process, so it does not survive a
/// serverless cold start or share state between instances. Swap the four functions
/// below for real queries if that ever matters.

export type FeedEventType = "new_call" | "odds_swing" | "resolved_rug" | "resolved_safe" | "report";

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  chainId: number;
  address: string;
  detail: string;
  timestamp: string;
}

interface StoreShape {
  reports: Record<string, TrustReport>;
  feed: FeedEvent[];
}

const STORE_KEY = "polmad-store";
const MAX_FEED = 200;

let cache: StoreShape | null = null;
let loaded = false;

/// Hydrated lazily and cached in-process. On serverless without KV this simply
/// means a cold cache per instance — reports regenerate, which is acceptable
/// because everything here is re-derivable from chain data.
async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const raw = await kvGet(STORE_KEY);
  try {
    cache = raw ? (JSON.parse(raw) as StoreShape) : { reports: {}, feed: [] };
  } catch {
    cache = { reports: {}, feed: [] };
  }
}

function load(): StoreShape {
  if (!cache) cache = { reports: {}, feed: [] };
  return cache;
}

function persist() {
  void kvSet(STORE_KEY, JSON.stringify(cache));
}

const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

export async function getCachedReport(chainId: number, address: string): Promise<TrustReport | null> {
  await ensureLoaded();
  return load().reports[key(chainId, address)] ?? null;
}

export function putCachedReport(report: TrustReport) {
  const s = load();
  s.reports[key(report.chainId, report.address)] = report;
  persist();
}

export function listReports(): TrustReport[] {
  return Object.values(load().reports).sort(
    (a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
  );
}

export function pushFeedEvent(event: Omit<FeedEvent, "id" | "timestamp">) {
  const s = load();
  s.feed.unshift({
    ...event,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  });
  s.feed = s.feed.slice(0, MAX_FEED);
  persist();
}

export function listFeed(limit = 50): FeedEvent[] {
  return load().feed.slice(0, limit);
}

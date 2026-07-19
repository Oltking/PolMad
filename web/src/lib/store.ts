import fs from "node:fs";
import path from "node:path";
import type { TrustReport } from "./types";

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

const DATA_DIR = process.env.POLYMAD_DATA_DIR ?? path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const MAX_FEED = 200;

let cache: StoreShape | null = null;

function load(): StoreShape {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as StoreShape;
  } catch {
    cache = { reports: {}, feed: [] };
  }
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    // A cache that cannot write is still a working cache in memory. Never fail a
    // user-facing request because the disk is read-only.
    console.warn("[store] persist failed:", (err as Error).message);
  }
}

const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

export function getCachedReport(chainId: number, address: string): TrustReport | null {
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

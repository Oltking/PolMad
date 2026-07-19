import fs from "node:fs";
import path from "node:path";

/// Pluggable persistence.
///
/// Local dev writes to disk. Vercel cannot: the serverless filesystem is
/// read-only apart from /tmp, and /tmp is per-invocation, so an index written
/// during one request is simply gone by the next. Left unaddressed the leaderboard
/// would re-index from scratch on every request forever and never finish.
///
/// So storage is chosen at runtime:
///   1. Upstash Redis, if credentials are present  → durable, works on Vercel
///   2. Local filesystem, if writable              → local dev
///   3. In-process memory                          → last resort, honest about it
///
/// `durable` tells callers which they got, so the UI can say "history resets
/// between requests" rather than silently showing an empty leaderboard.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const DATA_DIR = process.env.POLMAD_DATA_DIR ?? path.join(process.cwd(), ".data");
const memory = new Map<string, string>();

export type Backend = "redis" | "file" | "memory";

let detected: Backend | null = null;

export function backend(): Backend {
  if (detected) return detected;

  if (REDIS_URL && REDIS_TOKEN) {
    detected = "redis";
  } else {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.accessSync(DATA_DIR, fs.constants.W_OK);
      detected = "file";
    } catch {
      detected = "memory";
    }
  }
  return detected;
}

/// True when data survives between requests. False means every request starts
/// cold — a real limitation the UI must not hide.
export function isDurable(): boolean {
  return backend() !== "memory";
}

export async function kvGet(key: string): Promise<string | null> {
  switch (backend()) {
    case "redis":
      try {
        const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
          cache: "no-store",
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { result?: string | null };
        return json.result ?? null;
      } catch {
        return null;
      }
    case "file":
      try {
        return fs.readFileSync(path.join(DATA_DIR, `${key}.json`), "utf8");
      } catch {
        return null;
      }
    default:
      return memory.get(key) ?? null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  switch (backend()) {
    case "redis":
      try {
        // POST body form avoids URL-length limits — the index can be large.
        await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
          body: value,
        });
      } catch {
        /* a failed write means re-indexing later, not a broken request */
      }
      return;
    case "file":
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), value);
      } catch {
        /* non-fatal */
      }
      return;
    default:
      memory.set(key, value);
  }
}

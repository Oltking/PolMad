import { getAddress, type Address } from "viem";

/// Pool discovery via GeckoTerminal (free, no API key).
///
/// This closes a real gap. The LIQUIDITY_PULL trigger could never fire before,
/// because pools had to be supplied by hand in config and nobody was going to do
/// that per target. We still refuse to *guess* pool addresses — computing a pair
/// address from a hardcoded factory would mean watching the wrong balance and
/// possibly resolving a Call wrongly, which costs users real money — but looking
/// them up from a source that actually indexes DEXes is a different thing.
///
/// Coverage is honest: testnets are not indexed, and new tokens are not listed.
/// A miss means the trigger simply cannot fire for that target, which is stated
/// rather than silently treated as "no liquidity was pulled".

const BASE = "https://api.geckoterminal.com/api/v2";

const NETWORK_SLUG: Record<number, string> = {
  1: "eth",
  8453: "base",
  143: "monad",
  // 10143 (Monad testnet) has no coverage and never will.
};

export interface PoolLookup {
  pools: Address[];
  supported: boolean;
  reason?: string;
}

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: PoolLookup }>();

export async function lookupPools(chainId: number, target: Address): Promise<PoolLookup> {
  // Explicit config always wins — an operator watching a specific pool knows
  // something the index does not.
  const manual = process.env[`POOLS_${target.toUpperCase()}`] ?? process.env.DEFAULT_POOLS ?? "";
  const manualPools = manual
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => getAddress(s) as Address);
  if (manualPools.length > 0) return { pools: manualPools, supported: true };

  const slug = NETWORK_SLUG[chainId];
  if (!slug) {
    return {
      pools: [],
      supported: false,
      reason: `no pool index for chain ${chainId} (testnets are not indexed)`,
    };
  }

  const key = `${chainId}:${target.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  try {
    const res = await fetch(`${BASE}/networks/${slug}/tokens/${target}/pools`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 404) {
      const data = { pools: [], supported: true, reason: "token not listed — no pools to watch" };
      cache.set(key, { at: Date.now(), data });
      return data;
    }
    if (!res.ok) return { pools: [], supported: true, reason: `pool lookup HTTP ${res.status}` };

    const json = (await res.json()) as { data?: { attributes?: { address?: string } }[] };
    const pools: Address[] = [];
    for (const p of json?.data ?? []) {
      const addr = p?.attributes?.address;
      if (typeof addr === "string" && addr.startsWith("0x")) {
        try {
          pools.push(getAddress(addr) as Address);
        } catch {
          /* malformed address from the index — skip rather than trust it */
        }
      }
    }

    const data: PoolLookup = { pools: pools.slice(0, 10), supported: true };
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    return { pools: [], supported: true, reason: `pool lookup failed: ${(err as Error).message}` };
  }
}

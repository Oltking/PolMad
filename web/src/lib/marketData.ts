/// Market + liquidity data from GeckoTerminal (CoinGecko's on-chain arm).
///
/// Free, no API key. Fills the gap our own RPC reads cannot: how much liquidity
/// actually backs a token, across which pools, and how old those pools are.
///
/// THE RULE THAT MATTERS: absence of data is never evidence of safety.
/// GeckoTerminal returns 404 for anything unlisted — which describes every token
/// on its first day, i.e. exactly when a rug is most likely and a warning most
/// valuable. So a miss produces `null` and an explicit "not listed" note, never a
/// clean bill of health.
///
/// Testnets are not covered at all. Reports there stay RPC-only and say so.

const BASE = "https://api.geckoterminal.com/api/v2";

/// chainId -> GeckoTerminal network slug. Only chains we have verified.
const NETWORK_SLUG: Record<number, string> = {
  1: "eth",
  8453: "base",
  143: "monad",
  // 10143 (Monad testnet) intentionally absent — no coverage exists.
};

export interface PoolInfo {
  address: string;
  name: string;
  reserveUsd: number | null;
  createdAt?: string;
  dex?: string;
}

export interface MarketData {
  listed: boolean;
  /// Why we have no data, when we have none. Shown to the user verbatim.
  unavailableReason?: string;
  priceUsd?: number | null;
  fdvUsd?: number | null;
  marketCapUsd?: number | null;
  volume24hUsd?: number | null;
  totalLiquidityUsd?: number | null;
  pools: PoolInfo[];
  /// Share of total liquidity sitting in the single largest pool. A token whose
  /// entire market is one pool can be drained in one transaction.
  topPoolShare?: number | null;
}

const CACHE_MS = 120_000;
const cache = new Map<string, { at: number; data: MarketData }>();

export function isMarketDataSupported(chainId: number): boolean {
  return chainId in NETWORK_SLUG;
}

export async function fetchMarketData(chainId: number, address: string): Promise<MarketData> {
  const slug = NETWORK_SLUG[chainId];
  if (!slug) {
    return {
      listed: false,
      pools: [],
      unavailableReason:
        "No market-data coverage for this network (testnets are never covered), so liquidity could not be assessed.",
    };
  }

  const key = `${chainId}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  try {
    const [tokenRes, poolsRes] = await Promise.all([
      fetch(`${BASE}/networks/${slug}/tokens/${address}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`${BASE}/networks/${slug}/tokens/${address}/pools`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    if (tokenRes.status === 404) {
      const data: MarketData = {
        listed: false,
        pools: [],
        unavailableReason:
          "Not listed on GeckoTerminal — this is normal for brand-new tokens and means liquidity could NOT be verified. Treat it as unknown, not safe.",
      };
      cache.set(key, { at: Date.now(), data });
      return data;
    }

    if (!tokenRes.ok) {
      return {
        listed: false,
        pools: [],
        unavailableReason: `Market data lookup failed (HTTP ${tokenRes.status}).`,
      };
    }

    const tokenJson = await tokenRes.json();
    const a = tokenJson?.data?.attributes ?? {};

    const pools: PoolInfo[] = [];
    if (poolsRes.ok) {
      const poolsJson = await poolsRes.json();
      for (const p of poolsJson?.data ?? []) {
        pools.push({
          address: p.attributes?.address ?? "",
          name: p.attributes?.name ?? "",
          reserveUsd: num(p.attributes?.reserve_in_usd),
          createdAt: p.attributes?.pool_created_at,
          dex: p.relationships?.dex?.data?.id,
        });
      }
    }

    pools.sort((x, y) => (y.reserveUsd ?? 0) - (x.reserveUsd ?? 0));

    const totalLiquidityUsd = num(a.total_reserve_in_usd);
    const poolSum = pools.reduce((acc, p) => acc + (p.reserveUsd ?? 0), 0);
    const topPoolShare =
      pools.length > 0 && poolSum > 0 ? (pools[0].reserveUsd ?? 0) / poolSum : null;

    const data: MarketData = {
      listed: true,
      priceUsd: num(a.price_usd),
      fdvUsd: num(a.fdv_usd),
      marketCapUsd: num(a.market_cap_usd),
      volume24hUsd: num(a.volume_usd?.h24),
      totalLiquidityUsd,
      pools: pools.slice(0, 10),
      topPoolShare,
    };

    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    return {
      listed: false,
      pools: [],
      unavailableReason: `Market data unavailable: ${(err as Error).message}`,
    };
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

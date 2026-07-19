/// Social & community signals.
///
/// Originally a stated non-goal in the spec, and reasonably so: social presence is
/// the easiest thing on this whole report to fake. Followers are purchasable,
/// Telegram groups can be filled with bots, and a website is twenty minutes' work.
///
/// So this is scored ASYMMETRICALLY, and that asymmetry is the entire point:
///
///   - ABSENCE is strong evidence. A token with no site, no socials and no
///     listing, that nobody is watching, is a genuine red flag — real projects
///     leave traces.
///   - PRESENCE is weak evidence. Having a Twitter proves someone made a Twitter.
///     It caps out fast and never drives the score to "safe" on its own.
///
/// A scanner that rewarded follower counts would be trivially gamed by exactly the
/// people it exists to catch, so this never does that.

const GT = "https://api.geckoterminal.com/api/v2";
const CG = "https://api.coingecko.com/api/v3";

const GT_NETWORK: Record<number, string> = { 1: "eth", 8453: "base", 143: "monad" };
const CG_PLATFORM: Record<number, string> = { 1: "ethereum", 8453: "base", 143: "monad" };

export interface SocialData {
  checked: boolean;
  unavailableReason?: string;
  website?: string | null;
  twitter?: string | null;
  telegram?: string | null;
  discord?: string | null;
  description?: string | null;
  /// GeckoTerminal's own listing-quality score (0-100): how complete a token's
  /// public profile is. Not a safety rating, and not treated as one.
  gtScore?: number | null;
  telegramUsers?: number | null;
  redditSubs?: number | null;
  watchlistUsers?: number | null;
  sentimentUpPct?: number | null;
  /// True when the token has any discoverable public presence at all.
  hasAnyPresence: boolean;
}

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; data: SocialData }>();

export async function fetchSocial(chainId: number, address: string): Promise<SocialData> {
  const gtNet = GT_NETWORK[chainId];
  if (!gtNet) {
    return {
      checked: false,
      hasAnyPresence: false,
      unavailableReason: "No social/community index covers this network (testnets are never indexed).",
    };
  }

  const key = `${chainId}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const [gt, cg] = await Promise.all([
    fetchJson(`${GT}/networks/${gtNet}/tokens/${address}/info`),
    CG_PLATFORM[chainId]
      ? fetchJson(`${CG}/coins/${CG_PLATFORM[chainId]}/contract/${address}`)
      : Promise.resolve(null),
  ]);

  const a = (gt as { data?: { attributes?: Record<string, unknown> } })?.data?.attributes ?? {};
  const c = (cg as { community_data?: Record<string, number | null> })?.community_data ?? {};
  const links = (cg as { links?: { homepage?: string[] } })?.links ?? {};

  const website =
    (Array.isArray(a.websites) && (a.websites as string[])[0]) || links.homepage?.[0] || null;
  const twitter = (a.twitter_handle as string) ?? null;
  const telegram = (a.telegram_handle as string) ?? null;
  const discord = (a.discord_url as string) ?? null;

  const data: SocialData = {
    checked: !!gt || !!cg,
    unavailableReason:
      !gt && !cg
        ? "Not listed on any social/community index. For a new token this is normal — and it means community presence is UNVERIFIED, not absent."
        : undefined,
    website,
    twitter,
    telegram,
    discord,
    description: (a.description as string) ?? null,
    gtScore: typeof a.gt_score === "number" ? a.gt_score : null,
    telegramUsers: c.telegram_channel_user_count ?? null,
    redditSubs: c.reddit_subscribers ?? null,
    watchlistUsers:
      (cg as { watchlist_portfolio_users?: number })?.watchlist_portfolio_users ?? null,
    sentimentUpPct:
      (cg as { sentiment_votes_up_percentage?: number })?.sentiment_votes_up_percentage ?? null,
    hasAnyPresence: !!(website || twitter || telegram || discord),
  };

  cache.set(key, { at: Date.now(), data });
  return data;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

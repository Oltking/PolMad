import { readFeed } from "@/lib/feed";
import { DEFAULT_STAKING_CHAIN, STAKING_NETWORKS, type StakingChainId } from "@/lib/networks";

/// GET /api/feed?chainId=10143
///
/// The feed is a client-side poll rather than a server-rendered page so it can
/// follow the user's selected network and refresh without a navigation.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = Number(searchParams.get("chainId"));
  const chainId = (STAKING_NETWORKS[raw as StakingChainId] ? raw : DEFAULT_STAKING_CHAIN) as StakingChainId;

  try {
    const feed = await readFeed(chainId);
    return Response.json({
      ...feed,
      // bigint is not JSON-serialisable; the client only needs it for ordering.
      items: feed.items.map((i) => ({ ...i, blockNumber: i.blockNumber.toString() })),
    });
  } catch (err) {
    return Response.json(
      { items: [], degraded: true, error: (err as Error).message },
      { status: 200 },
    );
  }
}

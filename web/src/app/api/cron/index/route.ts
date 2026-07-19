import { advanceIndex } from "@/lib/indexer";
import { STAKING_NETWORKS, isNetworkLive, type StakingChainId } from "@/lib/networks";

/// GET /api/cron/index — advances the event index one tick per network.
///
/// On Vercel the request handler is frozen the moment it responds, so the
/// self-driving loop used locally cannot run. Vercel Cron calls this instead
/// (see vercel.json). Each call advances a bounded number of chunks, so the
/// index catches up over several invocations rather than timing out on one.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  // Vercel sets this header on cron invocations. When CRON_SECRET is configured
  // we require it — this endpoint does real RPC work and should not be a free
  // denial-of-wallet for anyone who finds the URL.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const results: Record<string, unknown> = {};

  for (const network of Object.values(STAKING_NETWORKS)) {
    if (!isNetworkLive(network)) continue;
    try {
      const state = await advanceIndex(network.id as StakingChainId);
      results[network.label] = {
        cursor: state.cursor,
        head: state.head,
        stakes: state.stakes.length,
        synced: BigInt(state.cursor) >= BigInt(state.head || "0"),
      };
    } catch (err) {
      results[network.label] = { error: (err as Error).message };
    }
  }

  return Response.json({ ok: true, results });
}

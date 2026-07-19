import { getIndex } from "@/lib/indexer";
import { DEFAULT_STAKING_CHAIN, type StakingChainId } from "@/lib/networks";

/// GET /api/call-history?chainId=10143&callId=1
///
/// Stake-by-stake history for one call, powering the odds chart. Served from the
/// incremental index rather than a live log sweep — sweeping per request could
/// never reach far enough back before its deadline expired.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chainId = (Number(searchParams.get("chainId")) || DEFAULT_STAKING_CHAIN) as StakingChainId;
  const callId = searchParams.get("callId");

  if (!callId) return Response.json({ error: "callId required" }, { status: 400 });

  try {
    const idx = await getIndex(chainId);
    const points = idx.stakes
      .filter((s) => s.callId === callId)
      .sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)))
      .map((s) => ({
        blockNumber: s.blockNumber,
        totalSafeStake: s.totalSafeStake,
        totalRugStake: s.totalRugStake,
        amount: s.amount,
        betRug: s.betRug,
      }));

    return Response.json({ points, complete: idx.synced, progressPct: idx.progressPct });
  } catch (err) {
    return Response.json({ points: [], complete: false, error: (err as Error).message });
  }
}

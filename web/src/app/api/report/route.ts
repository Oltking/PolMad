import { keccak256, toHex } from "viem";
import { gatherEvidence } from "@/lib/evidence";
import { computeSubScores, computeOverallScore, fallbackSummary } from "@/lib/scoring";
import { generateNarrative } from "@/lib/llm";
import { chainById } from "@/lib/chains";
import { getCachedReport, putCachedReport } from "@/lib/store";
import type { TrustReport } from "@/lib/types";
import { attestReport, readLatestAttestation } from "@/lib/attest";

/// GET /api/report?chainId=1&address=0x...
///
/// Free and wallet-free by design — this is the top of the funnel (spec §3.3), so
/// it must work for someone who has never touched Monad.

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address")?.trim();
  const chainId = Number(searchParams.get("chainId"));
  const force = searchParams.get("refresh") === "1";

  if (!address) {
    return Response.json({ error: "Missing `address`" }, { status: 400 });
  }
  if (!chainById(chainId)) {
    return Response.json({ error: `Unsupported or missing chainId: ${chainId}` }, { status: 400 });
  }

  const cached = getCachedReport(chainId, address);
  if (cached && !force && Date.now() - new Date(cached.generatedAt).getTime() < CACHE_TTL_MS) {
    return Response.json({
      report: cached,
      reportHash: hashReport(cached),
      cached: true,
      attestation: await readLatestAttestation(chainId, address),
    });
  }

  try {
    const evidence = await gatherEvidence(chainId, address);
    const subScores = computeSubScores(evidence);
    const { score, verdict } = computeOverallScore(subScores);
    const fallback = fallbackSummary(evidence, subScores, verdict);

    const narrative = await generateNarrative(evidence, subScores, score, verdict, fallback);

    const report: TrustReport = {
      chainId,
      address,
      riskScore: score,
      verdict,
      summary: narrative.summary,
      subScores,
      evidence,
      generatedAt: new Date().toISOString(),
      model: narrative.model,
      fallbackUsed: narrative.fallbackUsed,
    };

    putCachedReport(report);

    // The hash is taken over exactly the bytes the client receives — otherwise the
    // on-chain attestation proves nothing about the report anyone actually saw.
    const reportHash = hashReport(report);

    // Commit the hash on-chain. Awaited so the UI can show the transaction, but a
    // failure only omits the attestation — it never fails the report itself.
    const attestation = await attestReport(chainId, address, report.riskScore, reportHash);

    return Response.json({ report, reportHash, cached: false, attestation });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}

export function hashReport(report: TrustReport): `0x${string}` {
  return keccak256(toHex(JSON.stringify(report)));
}

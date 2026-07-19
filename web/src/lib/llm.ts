import type { RawEvidence, SubScore } from "./types";

/// Narrative generation via Groq's OpenAI-compatible chat completions API.
///
/// The model is given ONLY the evidence we actually gathered, and is explicitly
/// forbidden from adding facts or producing a score. Scores are computed in
/// `scoring.ts` from observations; the model's job is to explain them in plain
/// language to someone about to sign a transaction.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You write short, plain-language risk explanations for crypto contracts.

Rules, in order of importance:
1. Use ONLY the evidence given to you. Never state a fact that is not in the evidence.
2. If something was not checked, say it was not checked. Never imply an unchecked item is fine.
3. Do not invent or restate a numeric risk score. The score is computed elsewhere.
4. No hype, no reassurance, no financial advice. A reader is deciding whether to sign a transaction.
5. Write 2-4 sentences, in the second person, at a level a non-developer understands.
6. If the evidence is thin, your main message should be that the evidence is thin.`;

export interface NarrativeResult {
  summary: string;
  model: string;
  fallbackUsed: boolean;
}

export async function generateNarrative(
  evidence: RawEvidence,
  subScores: SubScore[],
  computedScore: number,
  verdict: string,
  fallback: string,
): Promise<NarrativeResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { summary: fallback, model: "deterministic-fallback", fallbackUsed: true };
  }

  const evidenceBlock = JSON.stringify(
    {
      isContract: evidence.isContract,
      verified: evidence.isVerified,
      contractName: evidence.contractName,
      owner: evidence.owner,
      ownershipRenounced: evidence.ownershipRenounced,
      mintSelectorPresent: evidence.hasMintFunction,
      pauseSelectorPresent: evidence.hasPauseFunction,
      blacklistSelectorPresent: evidence.hasBlacklistFunction,
      symbol: evidence.symbol,
      computedRiskScore: computedScore,
      verdict,
      subScores: subScores.map((s) => ({
        category: s.label,
        score: s.score,
        findings: s.findings,
        notChecked: s.unavailableReason ?? null,
      })),
      dataGaps: evidence.gaps,
    },
    null,
    2,
  );

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Evidence:\n${evidenceBlock}\n\nWrite the explanation.` },
        ],
      }),
      // A slow model must not hang the report — the deterministic fallback is
      // always a usable answer, so we bail rather than make the user wait.
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[llm] Groq returned ${res.status}; using deterministic fallback`);
      return { summary: fallback, model: "deterministic-fallback", fallbackUsed: true };
    }

    const json = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { summary: fallback, model: "deterministic-fallback", fallbackUsed: true };
    }

    return { summary: text, model: MODEL, fallbackUsed: false };
  } catch (err) {
    console.warn(`[llm] narrative generation failed: ${(err as Error).message}`);
    return { summary: fallback, model: "deterministic-fallback", fallbackUsed: true };
  }
}

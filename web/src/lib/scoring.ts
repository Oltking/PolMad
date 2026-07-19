import type { RawEvidence, SubScore, TrustReport } from "./types";

/// Deterministic scoring. The model writes the *narrative*; the numbers come from
/// here, from observed evidence only.
///
/// This split is deliberate and is the core safety property of the report: an LLM
/// asked to produce a risk score will happily produce a confident number for a
/// contract it knows nothing about. Scores computed here can always be traced to a
/// specific observation, and "unknown" stays unknown instead of drifting to "safe".

const LABELS: Record<string, string> = {
  ownership: "Ownership & admin control",
  liquidity: "Liquidity",
  holderConcentration: "Holder concentration",
  verification: "Source verification",
  mintBurnControl: "Mint & burn control",
};

export function computeSubScores(e: RawEvidence): SubScore[] {
  if (!e.isContract) {
    return (Object.keys(LABELS) as (keyof typeof LABELS)[]).map((key) => ({
      key: key as SubScore["key"],
      label: LABELS[key],
      score: null,
      findings: [],
      unavailableReason: "Address is an EOA, not a contract.",
    }));
  }

  const ownership: SubScore = { key: "ownership", label: LABELS.ownership, score: 0, findings: [] };
  if (e.ownershipRenounced) {
    ownership.score = 10;
    ownership.findings.push(`Ownership appears renounced (owner is ${e.owner}).`);
  } else if (e.owner) {
    ownership.score = 55;
    ownership.findings.push(`Active owner: ${e.owner}. This address retains privileged control.`);
    if (e.hasPauseFunction) {
      ownership.score += 20;
      ownership.findings.push("Bytecode contains a pause selector — the owner may be able to halt transfers.");
    }
    if (e.hasBlacklistFunction) {
      ownership.score += 15;
      ownership.findings.push("Bytecode contains a blacklist selector — specific wallets may be blockable.");
    }
  } else {
    ownership.score = null;
    ownership.unavailableReason = "No standard `owner()` function; ownership model undetermined.";
  }
  if (ownership.score !== null) ownership.score = Math.min(100, ownership.score);

  const mintBurn: SubScore = { key: "mintBurnControl", label: LABELS.mintBurnControl, score: 0, findings: [] };
  if (e.hasMintFunction === null) {
    mintBurn.score = null;
    mintBurn.unavailableReason =
      "Could not inspect the implementation bytecode (proxy) — mint capability is unknown, not absent.";
  } else if (e.hasMintFunction) {
    // A mint function guarded by renounced ownership is far less dangerous than one
    // behind a live owner key, so the two signals are scored together.
    mintBurn.score = e.ownershipRenounced ? 25 : 75;
    mintBurn.findings.push(
      e.ownershipRenounced
        ? "A mint selector is present, but ownership appears renounced."
        : "A mint selector is present and an active owner could call it, allowing supply inflation.",
    );
  } else {
    mintBurn.score = 10;
    mintBurn.findings.push("No common mint selector found in the deployed bytecode.");
  }

  const verification: SubScore = { key: "verification", label: LABELS.verification, score: null, findings: [] };
  if (e.isVerified === null) {
    verification.unavailableReason = "Explorer verification status unavailable for this chain.";
  } else if (e.isVerified) {
    verification.score = 10;
    verification.findings.push(`Source is verified${e.contractName ? ` as \`${e.contractName}\`` : ""}.`);
  } else {
    verification.score = 70;
    verification.findings.push("Source is NOT verified — the deployed bytecode cannot be reviewed.");
  }

  // Liquidity, now measured from real pool data.
  //
  // Two distinct risks are scored here, and they are not the same thing:
  //   depth        — thin liquidity means the price can be moved by anyone
  //   concentration— one pool holding everything can be pulled in one transaction
  //
  // An unlisted token scores `null`, never 0. A token nobody has pooled is the
  // most dangerous case there is, and must not read as "no liquidity risk".
  const liquidity: SubScore = { key: "liquidity", label: LABELS.liquidity, score: null, findings: [] };
  const m = e.market;

  if (!m || !m.listed) {
    liquidity.unavailableReason =
      m?.unavailableReason ??
      "No liquidity data available. This is expected for new tokens and means liquidity is UNVERIFIED, not absent.";
  } else {
    const liq = m.totalLiquidityUsd ?? 0;
    let score: number;
    if (liq >= 1_000_000) score = 5;
    else if (liq >= 250_000) score = 15;
    else if (liq >= 50_000) score = 35;
    else if (liq >= 10_000) score = 60;
    else if (liq > 0) score = 80;
    else score = 90;

    liquidity.findings.push(
      liq > 0
        ? `$${Math.round(liq).toLocaleString()} total liquidity across ${m.pools.length} pool(s).`
        : "Listed, but no measurable liquidity in any pool.",
    );

    // A single pool holding nearly everything is the classic pull setup.
    if (m.topPoolShare !== null && m.topPoolShare !== undefined && m.pools.length > 0) {
      const pct = Math.round(m.topPoolShare * 100);
      if (m.topPoolShare >= 0.9 && m.pools.length > 1) {
        score += 15;
        liquidity.findings.push(`${pct}% of liquidity sits in one pool — a single withdrawal could drain the market.`);
      } else if (m.pools.length === 1) {
        score += 20;
        liquidity.findings.push("Only one pool exists — there is no fallback market if it is pulled.");
      } else {
        liquidity.findings.push(`Largest pool holds ${pct}% of liquidity.`);
      }
    }

    if (m.volume24hUsd !== null && m.volume24hUsd !== undefined && liq > 0) {
      const turnover = m.volume24hUsd / liq;
      // Volume far above the liquidity backing it is a wash-trading signature.
      if (turnover > 10) {
        score += 10;
        liquidity.findings.push(
          `24h volume is ${turnover.toFixed(1)}x total liquidity — unusually high turnover for this depth.`,
        );
      }
    }

    liquidity.score = Math.min(100, score);
  }
  const holders: SubScore = {
    key: "holderConcentration",
    label: LABELS.holderConcentration,
    score: null,
    findings: [],
    unavailableReason: "Holder distribution requires an indexer or paid explorer tier.",
  };

  return [ownership, liquidity, holders, verification, mintBurn];
}

/// Weighted mean over the sub-scores we could actually compute. Missing categories
/// are excluded rather than treated as zero — averaging in an absent category as
/// "safe" is exactly how a scanner ends up blessing a contract it never inspected.
export function computeOverallScore(subScores: SubScore[]): {
  score: number;
  verdict: TrustReport["verdict"];
} {
  const weights: Record<string, number> = {
    ownership: 0.3,
    mintBurnControl: 0.3,
    verification: 0.2,
    liquidity: 0.1,
    holderConcentration: 0.1,
  };

  const known = subScores.filter((s) => s.score !== null);
  if (known.length === 0) return { score: 0, verdict: "INSUFFICIENT_DATA" };

  const totalWeight = known.reduce((acc, s) => acc + (weights[s.key] ?? 0), 0);
  const weighted = known.reduce((acc, s) => acc + (s.score as number) * (weights[s.key] ?? 0), 0);
  const score = Math.round(weighted / totalWeight);

  // If we're missing most of the picture, say so rather than issuing a confident
  // verdict off two signals.
  const coverage = totalWeight;
  let verdict: TrustReport["verdict"];
  if (coverage < 0.5) verdict = "INSUFFICIENT_DATA";
  else if (score >= 70) verdict = "HIGH_RISK";
  else if (score >= 40) verdict = "ELEVATED";
  else verdict = "LOW_RISK";

  return { score, verdict };
}

/// Narrative used when no LLM is available or the model returns something unusable.
/// Reads plainly and never claims more than the evidence supports.
export function fallbackSummary(e: RawEvidence, subScores: SubScore[], verdict: TrustReport["verdict"]): string {
  if (!e.isContract) {
    return "This address has no code deployed to it — it is a wallet, not a contract. There is nothing to analyse, and any site describing it as an audited contract is wrong.";
  }

  const flags = subScores.flatMap((s) => s.findings);
  const unknowns = subScores.filter((s) => s.score === null).map((s) => s.label.toLowerCase());

  const parts: string[] = [];
  parts.push(
    verdict === "INSUFFICIENT_DATA"
      ? "There is not enough data to give this contract a meaningful score."
      : `Automated checks rate this contract ${verdict.replace("_", " ").toLowerCase()}.`,
  );
  if (flags.length) parts.push(`What was observed: ${flags.join(" ")}`);
  if (unknowns.length) parts.push(`Not checked: ${unknowns.join(", ")}.`);
  parts.push("This is a risk signal derived from public data, not financial advice or an audit.");
  return parts.join(" ");
}

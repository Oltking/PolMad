/// Shape of a Trust Report. This is the contract between the report service, the
/// cache, and the UI — and the thing whose hash gets committed to TrustRegistry,
/// so any change here is a breaking change for verifying old attestations.

export type SubScoreKey =
  | "ownership"
  | "liquidity"
  | "holderConcentration"
  | "verification"
  | "mintBurnControl"
  | "community";

export interface SubScore {
  key: SubScoreKey;
  label: string;
  /// 0-100, higher = riskier. Null when we could not gather the underlying data —
  /// explicitly distinct from 0, because "we don't know" must never render as "safe".
  score: number | null;
  /// What the score is based on. Always populated from real on-chain/explorer data;
  /// never invented by the model.
  findings: string[];
  /// Set when data was unavailable, so the UI can say why instead of showing a gap.
  unavailableReason?: string;
}

export interface RawEvidence {
  isVerified: boolean | null;
  contractName?: string;
  owner?: string | null;
  /// True when ownership appears renounced (owner is zero/dead address).
  ownershipRenounced?: boolean;
  hasMintFunction?: boolean | null;
  hasPauseFunction?: boolean | null;
  hasBlacklistFunction?: boolean | null;
  totalSupply?: string;
  decimals?: number;
  symbol?: string;
  topHolders?: { address: string; share: number }[];
  liquidityPools?: { address: string; label?: string }[];
  deployer?: string | null;
  deployedAt?: string | null;
  isContract: boolean;
  /// Liquidity + market context from GeckoTerminal. Null when unsupported/unlisted.
  market?: {
    listed: boolean;
    unavailableReason?: string;
    priceUsd?: number | null;
    fdvUsd?: number | null;
    volume24hUsd?: number | null;
    totalLiquidityUsd?: number | null;
    topPoolShare?: number | null;
    pools: { address: string; name: string; reserveUsd: number | null; createdAt?: string }[];
  };
  social?: {
    checked: boolean;
    unavailableReason?: string;
    website?: string | null;
    twitter?: string | null;
    telegram?: string | null;
    discord?: string | null;
    gtScore?: number | null;
    telegramUsers?: number | null;
    watchlistUsers?: number | null;
    sentimentUpPct?: number | null;
    hasAnyPresence: boolean;
  };
  /// Anything we tried to fetch and couldn't. Surfaced to the user verbatim.
  gaps: string[];
}

export interface TrustReport {
  chainId: number;
  address: string;
  /// 0-100, higher = riskier.
  riskScore: number;
  verdict: "LOW_RISK" | "ELEVATED" | "HIGH_RISK" | "INSUFFICIENT_DATA";
  summary: string;
  subScores: SubScore[];
  evidence: RawEvidence;
  generatedAt: string;
  /// Which model wrote the narrative, so a report is always attributable.
  model: string;
  /// True when the narrative came from the deterministic fallback rather than an
  /// LLM (no API key, or the model returned something unusable).
  fallbackUsed: boolean;
}

import { parseAbi, type Address } from "viem";

/// Deployed addresses come from env so a redeploy never requires a code change.
/// Zero address means "not deployed yet" — the UI checks this and disables the
/// staking surface rather than sending transactions into the void.
export const PROPHEY_MARKET = (process.env.NEXT_PUBLIC_PROPHEY_MARKET ??
  "0x0000000000000000000000000000000000000000") as Address;
export const TRUST_REGISTRY = (process.env.NEXT_PUBLIC_TRUST_REGISTRY ??
  "0x0000000000000000000000000000000000000000") as Address;
export const VERIFIER_BADGE = (process.env.NEXT_PUBLIC_VERIFIER_BADGE ??
  "0x0000000000000000000000000000000000000000") as Address;

export const ZERO = "0x0000000000000000000000000000000000000000";
export const isDeployed = (a: Address) => a.toLowerCase() !== ZERO;

export const propheyMarketAbi = parseAbi([
  "function callCount() view returns (uint256)",
  "function MIN_STAKE() view returns (uint256)",
  "function createCall(uint256 chainId, address target, uint256 windowSeconds) returns (uint256)",
  "function stake(uint256 callId, bool betRug) payable",
  "function claim(uint256 callId)",
  "function voidCall(uint256 callId)",
  "function payoutOf(uint256 callId, address wallet) view returns (uint256)",
  "function positionOf(uint256 callId, address wallet) view returns (uint256 onSafe, uint256 onRug, bool hasClaimed)",
  "function getCall(uint256 callId) view returns ((uint256 chainId, address target, address creator, uint256 windowEnd, uint256 totalSafeStake, uint256 totalRugStake, bool resolved, bool outcomeIsRug, bool voided))",
  "event CallCreated(uint256 indexed callId, uint256 indexed chainId, address indexed target, address creator, uint256 windowEnd)",
  "event Staked(uint256 indexed callId, address indexed wallet, bool betRug, uint256 amount, uint256 totalSafeStake, uint256 totalRugStake)",
  "event Resolved(uint256 indexed callId, bool outcomeIsRug, address resolvedBy)",
  "event Claimed(uint256 indexed callId, address indexed wallet, uint256 payout)",
]);

export const trustRegistryAbi = parseAbi([
  "function attest(uint256 chainId, address target, uint8 riskScore, bytes32 reportHash) returns (uint256)",
  "function getLatest(uint256 chainId, address target) view returns ((uint256 chainId, address target, uint8 riskScore, bytes32 reportHash, address attester, uint256 timestamp))",
  "function historyLength(uint256 chainId, address target) view returns (uint256)",
]);

export const verifierBadgeAbi = parseAbi([
  "function badgesOf(address wallet) view returns (uint256[])",
  "function badgeTypeOf(uint256 tokenId) view returns (uint256)",
]);

export const BADGE_NAMES = [
  "First Correct Call",
  "Five-Call Streak",
  "Against The Crowd",
  "Top 10 Weekly",
] as const;

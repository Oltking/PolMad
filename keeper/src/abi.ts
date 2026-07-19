import { parseAbi } from "viem";

export const propheyMarketAbi = parseAbi([
  "function callCount() view returns (uint256)",
  "function resolve(uint256 callId, bool rugOccurred)",
  "function getCall(uint256 callId) view returns ((uint256 chainId, address target, address creator, uint256 windowEnd, uint256 totalSafeStake, uint256 totalRugStake, bool resolved, bool outcomeIsRug, bool voided))",
  "event CallCreated(uint256 indexed callId, uint256 indexed chainId, address indexed target, address creator, uint256 windowEnd)",
  "event Staked(uint256 indexed callId, address indexed wallet, bool betRug, uint256 amount, uint256 totalSafeStake, uint256 totalRugStake)",
  "event Resolved(uint256 indexed callId, bool outcomeIsRug, address resolvedBy)",
  "event Claimed(uint256 indexed callId, address indexed wallet, uint256 payout)",
  "event Voided(uint256 indexed callId)",
]);

export const trustRegistryAbi = parseAbi([
  "function attest(uint256 chainId, address target, uint8 riskScore, bytes32 reportHash) returns (uint256)",
  "function getLatest(uint256 chainId, address target) view returns ((uint256 chainId, address target, uint8 riskScore, bytes32 reportHash, address attester, uint256 timestamp))",
  "function historyLength(uint256 chainId, address target) view returns (uint256)",
  "event Attested(uint256 indexed attestationId, uint256 indexed chainId, address indexed target, address attester, uint8 riskScore, bytes32 reportHash)",
]);

export const verifierBadgeAbi = parseAbi([
  "function mintBadge(address to, uint256 badgeType) returns (uint256)",
  "function badgesOf(address wallet) view returns (uint256[])",
  "function hasBadge(address wallet, uint256 badgeType) view returns (bool)",
  "event BadgeMinted(address indexed to, uint256 indexed tokenId, uint256 indexed badgeType)",
]);

/// Minimal surface we need from an arbitrary target token. Deliberately small:
/// the target is untrusted code and may not implement anything beyond ERC-20.
export const erc20Abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/// Event signatures that commonly accompany a transfer-blocking action. Matching on
/// events rather than calldata selectors keeps this working for proxies, where the
/// call goes to the proxy but the event is emitted by the implementation.
export const PAUSE_EVENT_SIGNATURES = [
  "event Paused(address account)",
  "event Paused(bool paused)",
  "event Blacklisted(address indexed wallet, bool blacklisted)",
  "event AddedBlackList(address indexed user)",
  "event TradingEnabled(bool enabled)",
] as const;

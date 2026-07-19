import { parseAbi } from "viem";

/// ABIs are network-independent. Addresses are NOT — they come from
/// `networks.ts` via the user's selected network, never from a module constant,
/// so a testnet address can never be used on mainnet.
export { isDeployed } from "./networks";

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

export const tokenFactoryAbi = parseAbi([
  "function createToken(string name_, string symbol_, uint8 decimals_, uint256 initialSupply, string metadataURI) returns (address)",
  "function launchCount() view returns (uint256)",
  "function isLaunchpadToken(address) view returns (bool)",
  "function recentLaunches(uint256 offset, uint256 limit) view returns ((address token, address creator, string name, string symbol, uint256 supply, uint256 timestamp)[])",
  "function launchesOf(address creator) view returns ((address token, address creator, string name, string symbol, uint256 supply, uint256 timestamp)[])",
  "event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, uint256 supply, string metadataURI)",
]);

export const launchpadTokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function metadataURI() view returns (string)",
]);

export const BADGE_NAMES = [
  "First Correct Call",
  "Five-Call Streak",
  "Against The Crowd",
  "Top 10 Weekly",
] as const;

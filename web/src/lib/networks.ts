import { defineChain, type Address } from "viem";

/// Chain ids and RPCs verified against the live endpoints, not copied from memory —
/// a wrong chain id on mainnet means real funds sent somewhere unrecoverable.
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://monadscan.com" } },
});

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } },
  testnet: true,
});

export type StakingChainId = 143 | 10143;

export interface Deployment {
  propheyMarket: Address;
  trustRegistry: Address;
  verifierBadge: Address;
  tokenFactory: Address;
  /// Demo-only rug token. Testnet only — deploying this to mainnet would be
  /// publishing a working scam contract, so it stays undefined there.
  mockRugToken?: Address;
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/// Next.js inlines `process.env.NEXT_PUBLIC_*` only when referenced literally, so
/// these cannot be built from a computed key.
const TESTNET_DEPLOYMENT: Deployment = {
  propheyMarket: (process.env.NEXT_PUBLIC_PROPHEY_MARKET ?? ZERO) as Address,
  trustRegistry: (process.env.NEXT_PUBLIC_TRUST_REGISTRY ?? ZERO) as Address,
  verifierBadge: (process.env.NEXT_PUBLIC_VERIFIER_BADGE ?? ZERO) as Address,
  tokenFactory: (process.env.NEXT_PUBLIC_TOKEN_FACTORY ?? ZERO) as Address,
  mockRugToken: process.env.NEXT_PUBLIC_MOCK_RUG_TOKEN as Address | undefined,
};

const MAINNET_DEPLOYMENT: Deployment = {
  propheyMarket: (process.env.NEXT_PUBLIC_PROPHEY_MARKET_MAINNET ?? ZERO) as Address,
  trustRegistry: (process.env.NEXT_PUBLIC_TRUST_REGISTRY_MAINNET ?? ZERO) as Address,
  verifierBadge: (process.env.NEXT_PUBLIC_VERIFIER_BADGE_MAINNET ?? ZERO) as Address,
  tokenFactory: (process.env.NEXT_PUBLIC_TOKEN_FACTORY_MAINNET ?? ZERO) as Address,
};

export interface StakingNetwork {
  id: StakingChainId;
  chain: typeof monadMainnet | typeof monadTestnet;
  label: string;
  shortLabel: string;
  isTestnet: boolean;
  deployment: Deployment;
  /// Where to get funds. Only meaningful on testnet.
  faucetUrl?: string;
}

export const STAKING_NETWORKS: Record<StakingChainId, StakingNetwork> = {
  10143: {
    id: 10143,
    chain: monadTestnet,
    label: "Monad Testnet",
    shortLabel: "TESTNET",
    isTestnet: true,
    deployment: TESTNET_DEPLOYMENT,
    faucetUrl: "https://faucet.monad.xyz",
  },
  143: {
    id: 143,
    chain: monadMainnet,
    label: "Monad Mainnet",
    shortLabel: "MAINNET",
    isTestnet: false,
    deployment: MAINNET_DEPLOYMENT,
  },
};

/// Testnet is the default on purpose. A user who has not made an explicit choice
/// must never end up staking real money because of a default we picked for them.
export const DEFAULT_STAKING_CHAIN: StakingChainId = 10143;

export const isDeployed = (a?: Address) => !!a && a.toLowerCase() !== ZERO;

export function networkFor(chainId: number): StakingNetwork {
  return STAKING_NETWORKS[chainId as StakingChainId] ?? STAKING_NETWORKS[DEFAULT_STAKING_CHAIN];
}

/// A network is only usable if its market contract actually exists there. This is
/// what lets the UI say "mainnet isn't live yet" instead of sending transactions
/// to the zero address.
export function isNetworkLive(n: StakingNetwork): boolean {
  return isDeployed(n.deployment.propheyMarket);
}

import { defineChain, createPublicClient, http, type PublicClient } from "viem";
import { mainnet, base } from "viem/chains";

/// Monad testnet. Chain id and RPC are the values confirmed in the spec — do not
/// guess these, a wrong chain id silently sends transactions nowhere useful.
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
  testnet: true,
});

/// Chains the keeper can watch target contracts on. Per spec §14 we start with
/// Monad + Ethereum and only add more once those two are solid; Base is included
/// because its RPC story is identical to Ethereum's and it costs nothing to keep.
export const WATCHED_CHAINS = {
  [monadTestnet.id]: monadTestnet,
  [mainnet.id]: mainnet,
  [base.id]: base,
} as const;

const rpcOverrides: Record<number, string | undefined> = {
  [monadTestnet.id]: process.env.MONAD_RPC_URL,
  [mainnet.id]: process.env.ETHEREUM_RPC_URL,
  [base.id]: process.env.BASE_RPC_URL,
};

const clientCache = new Map<number, PublicClient>();

/// A read client for whichever chain a target contract lives on. Returns null for
/// chains we have no RPC for, so callers can skip rather than crash the loop — a
/// Call on an unsupported chain must not stall resolution of every other Call.
export function publicClientFor(chainId: number): PublicClient | null {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  const chain = WATCHED_CHAINS[chainId as keyof typeof WATCHED_CHAINS];
  if (!chain) return null;

  const url = rpcOverrides[chainId] ?? chain.rpcUrls.default.http[0];
  if (!url) return null;

  const client = createPublicClient({ chain, transport: http(url) }) as PublicClient;
  clientCache.set(chainId, client);
  return client;
}

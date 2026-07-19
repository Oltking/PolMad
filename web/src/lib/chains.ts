import { defineChain } from "viem";
import { mainnet, base } from "viem/chains";

/// Monad testnet — values confirmed from the spec, never guessed.
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

export interface SupportedChain {
  id: number;
  label: string;
  /// Etherscan-family API host. Etherscan V2 serves every supported chain from one
  /// host keyed by chainid, which is why Ethereum and Base share an entry.
  explorerApi?: string;
  explorerUrl: string;
  /// Ordered fallbacks. A single public RPC WILL be down sometimes, and a report
  /// that silently degrades because one endpoint 521'd is worse than no report.
  rpcUrls: string[];
  /// Data quality caveat surfaced in the UI. Spec §14: cross-chain report quality
  /// depends on each chain's explorer coverage, and we say so rather than implying
  /// every chain gets an equally good report.
  coverage: "full" | "partial";
}

export const SUPPORTED_CHAINS: SupportedChain[] = [
  {
    id: mainnet.id,
    label: "Ethereum",
    explorerApi: "https://api.etherscan.io/v2/api",
    explorerUrl: "https://etherscan.io",
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://rpc.ankr.com/eth"],
    coverage: "full",
  },
  {
    id: base.id,
    label: "Base",
    explorerApi: "https://api.etherscan.io/v2/api",
    explorerUrl: "https://basescan.org",
    rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.drpc.org"],
    coverage: "full",
  },
  {
    id: monadTestnet.id,
    label: "Monad Testnet",
    explorerUrl: "https://testnet.monadvision.com",
    rpcUrls: ["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"],
    // No Etherscan-family API key coverage yet, so verification/source data is
    // unavailable and the report leans on on-chain reads alone.
    coverage: "partial",
  },
];

export function chainById(id: number): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

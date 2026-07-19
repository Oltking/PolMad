import { mainnet, base } from "viem/chains";
import { monadTestnet, monadMainnet } from "./networks";

/// Monad chain definitions live in networks.ts (the staking networks); re-exported
/// here so report-side code has one import for "chains we can analyse".
export { monadTestnet, monadMainnet };

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
    id: monadMainnet.id,
    label: "Monad",
    explorerUrl: "https://monadscan.com",
    rpcUrls: ["https://rpc.monad.xyz"],
    // No Etherscan-family API key coverage yet, so verification/source data is
    // unavailable and the report leans on on-chain reads alone.
    coverage: "partial",
  },
  {
    id: monadTestnet.id,
    label: "Monad Testnet",
    explorerUrl: "https://testnet.monadscan.com",
    rpcUrls: ["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"],
    coverage: "partial",
  },
];

export function chainById(id: number): SupportedChain | undefined {
  return SUPPORTED_CHAINS.find((c) => c.id === id);
}

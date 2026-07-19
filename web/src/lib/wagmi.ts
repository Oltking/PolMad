"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { monadTestnet } from "./chains";

/// Staking always happens on Monad regardless of which chain the target contract
/// lives on (spec §13), so Monad testnet is the only chain the wallet needs.
export const wagmiConfig = getDefaultConfig({
  appName: "Polymad",
  // WalletConnect needs a project id for its own relay. Injected wallets (MetaMask,
  // Rabby) still work without one, so a missing id degrades rather than breaks.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? "polymad-local-dev",
  chains: [monadTestnet],
  ssr: true,
});

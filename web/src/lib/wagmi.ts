"use client";

import { createConfig, http } from "wagmi";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";
import { monadMainnet, monadTestnet } from "./networks";

/// Both Monad networks are configured so the user can switch at runtime. Which one
/// is *active* is the user's explicit choice (see network-context), defaulting to
/// testnet — nobody should stake real money because of a default.
///
/// Built by hand rather than via RainbowKit's `getDefaultConfig`, which hard-throws
/// without a WalletConnect projectId even though injected wallets never need one.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID?.trim();

const connectors = [
  injected(),
  coinbaseWallet({ appName: "Polymad" }),
  ...(projectId ? [walletConnect({ projectId, showQrModal: false })] : []),
];

export const wagmiConfig = createConfig({
  chains: [monadTestnet, monadMainnet],
  connectors,
  transports: {
    [monadTestnet.id]: http(monadTestnet.rpcUrls.default.http[0]),
    [monadMainnet.id]: http(monadMainnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});

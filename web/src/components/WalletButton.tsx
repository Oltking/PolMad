"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/// Thin wrapper so the header stays a server component and the wallet UI is the
/// only thing that ships as client JS.
export function WalletButton() {
  return <ConnectButton showBalance={false} chainStatus="icon" accountStatus="address" />;
}

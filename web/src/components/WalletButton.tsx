"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/// Thin wrapper so the header stays a server component and the wallet UI is the
/// only thing that ships as client JS.
export function WalletButton() {
  return (
    <div className="scale-90 origin-right sm:scale-100">
      <ConnectButton
        showBalance={false}
        chainStatus="icon"
        accountStatus={{ smallScreen: "avatar", largeScreen: "address" }}
        label="Connect"
      />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import { STAKING_NETWORKS, isNetworkLive, type StakingChainId } from "@/lib/networks";

/// Network switch. Two things this must do that a plain dropdown would not:
///   - make MAINNET visually unmistakable, because the difference between the two
///     is "play money" vs "your money"
///   - require an explicit confirmation before moving to mainnet, so nobody stakes
///     real MON because they mis-clicked a select
export function NetworkSwitch() {
  const { network, setChainId } = useNetwork();
  const { switchChain } = useSwitchChain();
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<StakingChainId | null>(null);

  function choose(id: StakingChainId) {
    const target = STAKING_NETWORKS[id];
    if (id === network.id) {
      setOpen(false);
      return;
    }
    // Going to real money is a decision, not a menu selection.
    if (!target.isTestnet) {
      setConfirming(id);
      setOpen(false);
      return;
    }
    apply(id);
  }

  function apply(id: StakingChainId) {
    setChainId(id);
    setConfirming(null);
    setOpen(false);
    // Ask the wallet to follow. If the user declines, the app still shows the
    // chosen network and every action surfaces a "wrong network" warning.
    if (isConnected) switchChain?.({ chainId: id });
  }

  const live = isNetworkLive(network);

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="px-2.5 py-1.5 text-[10px] tracking-widest border flex items-center gap-1.5"
          style={{
            color: network.isTestnet ? "var(--muted)" : "var(--rug)",
            borderColor: network.isTestnet ? "var(--line)" : "var(--rug)",
          }}
          title={network.isTestnet ? "Play money" : "Real funds at risk"}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: network.isTestnet ? "var(--muted)" : "var(--rug)" }}
          />
          {network.shortLabel}
          {!live && <span style={{ color: "var(--warn)" }}>·not live</span>}
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 mt-1 z-50 panel w-56">
              {Object.values(STAKING_NETWORKS).map((n) => (
                <button
                  key={n.id}
                  onClick={() => choose(n.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface-2)] border-b border-[var(--line)] last:border-0"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-[11px]"
                      style={{ color: n.isTestnet ? "var(--fg)" : "var(--rug)" }}
                    >
                      {n.label}
                    </span>
                    {n.id === network.id && <span className="text-[10px] text-[var(--acid)]">●</span>}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mt-0.5">
                    {!isNetworkLive(n)
                      ? "Not deployed yet"
                      : n.isTestnet
                        ? "Free test MON"
                        : "Real MON — actual money"}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {confirming !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setConfirming(null)}
        >
          <div
            className="panel w-full max-w-sm border-[var(--rug)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[var(--rug)]">
              <h2 className="text-xs tracking-widest text-[var(--rug)]">SWITCHING TO REAL MONEY</h2>
            </div>
            <div className="p-4 space-y-3 text-[11px] text-[var(--muted)] leading-relaxed">
              <p className="text-[var(--fg)] text-xs">
                On Monad Mainnet you stake real MON. Losing bets are lost for real.
              </p>
              <ul className="space-y-1.5">
                <li>— These contracts are unaudited.</li>
                <li>
                  — Calls are resolved by a single keeper service. If it is wrong, offline, or
                  compromised, real funds are affected.
                </li>
                <li>
                  — If a call goes unresolved for 7 days past its window, anyone can void it and
                  everyone withdraws their original stake — but funds are locked until then.
                </li>
                <li>— Risk reports are automated signals, not audits, and can be wrong.</li>
              </ul>
              {!isNetworkLive(STAKING_NETWORKS[confirming]) && (
                <p className="text-[var(--warn)]">
                  Note: nothing is deployed to mainnet yet, so there is nothing to stake on. You can
                  still browse.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setConfirming(null)}
                  className="flex-1 py-2 text-xs border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]"
                >
                  STAY ON TESTNET
                </button>
                <button
                  onClick={() => apply(confirming)}
                  className="flex-1 py-2 text-xs font-bold bg-[var(--rug)] text-black"
                >
                  I UNDERSTAND
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";

/// Top-level product mode, in the spirit of an exchange app's Web3 ⇄ Exchange
/// toggle. Two genuinely different jobs share one wallet and one design language:
///
///   RADAR   — check contracts, price their risk, stake on outcomes
///   CREATOR — launch a token that cannot rug, and get everything you need to ship
///
/// Kept as a segmented control rather than a dropdown: mode is a place you are,
/// not a setting you configure, so both options stay visible at all times.
const MODES = [
  { key: "radar", label: "RADAR", href: "/", match: (p: string) => !p.startsWith("/create") && !p.startsWith("/launches") },
  { key: "creator", label: "CREATOR", href: "/create", match: (p: string) => p.startsWith("/create") || p.startsWith("/launches") },
];

export function ModeSwitch() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex border border-[var(--line)] shrink-0">
      {MODES.map((m) => {
        const active = m.match(pathname);
        return (
          <button
            key={m.key}
            onClick={() => router.push(m.href)}
            className="px-3 py-1.5 text-[10px] tracking-widest transition-colors"
            style={{
              background: active ? "var(--acid)" : "transparent",
              color: active ? "#08090a" : "var(--muted)",
              fontWeight: active ? 700 : 400,
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

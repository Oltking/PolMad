"use client";

import { formatEther } from "viem";

/// The odds bar is the product's signature object — it is what makes a contract's
/// safety feel like a live price rather than a static grade. Both sides are always
/// labelled with real staked amounts, so nobody reads a percentage without seeing
/// how thin the market behind it is.
export function OddsBar({
  safeStake,
  rugStake,
  compact = false,
}: {
  safeStake: bigint;
  rugStake: bigint;
  compact?: boolean;
}) {
  const total = safeStake + rugStake;

  if (total === 0n) {
    return (
      <div className="space-y-1">
        <div className="h-2 bg-[var(--surface-2)] border border-[var(--line)]" />
        <div className="text-[10px] text-[var(--muted)]">
          No stake yet — no market price. Be the first to take a side.
        </div>
      </div>
    );
  }

  const rugPct = Number((rugStake * 10000n) / total) / 100;
  const safePct = 100 - rugPct;

  return (
    <div className="space-y-1">
      <div className="flex h-2">
        <div style={{ width: `${safePct}%`, background: "var(--safe)" }} />
        <div style={{ width: `${rugPct}%`, background: "var(--rug)" }} />
      </div>
      <div className="flex justify-between text-[10px]">
        <span style={{ color: "var(--safe)" }}>
          SAFE {safePct.toFixed(1)}%
          {!compact && <span className="text-[var(--muted)]"> · {fmt(safeStake)} MON</span>}
        </span>
        <span style={{ color: "var(--rug)" }}>
          {!compact && <span className="text-[var(--muted)]">{fmt(rugStake)} MON · </span>}
          RUG {rugPct.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export function fmt(wei: bigint, dp = 3): string {
  const n = Number(formatEther(wei));
  return n.toLocaleString(undefined, { maximumFractionDigits: dp });
}

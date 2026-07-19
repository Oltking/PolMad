"use client";

import { useMemo } from "react";
import { formatEther } from "viem";

export interface StakePoint {
  blockNumber: bigint;
  totalSafeStake: bigint;
  totalRugStake: bigint;
  amount: bigint;
  betRug: boolean;
  timestamp?: number;
}

/// Odds history — the spec's "live odds chart", drawn from Staked events.
///
/// Plots implied RUG probability over time, which is simply the pool split. Two
/// deliberate choices:
///
///   - Points are the actual trades, not an interpolated curve. A market with
///     four stakes should look like four steps, not a smooth line implying
///     continuous activity that never happened.
///   - Dot size encodes stake size, so a 10 MON conviction bet is visually
///     distinct from a 0.01 MON nudge that moved the odds the same distance.
///
/// Inline SVG rather than a charting library: one series, ~50 points, and no
/// reason to ship a dependency for it.
export function OddsChart({ points }: { points: StakePoint[] }) {
  const series = useMemo(() => {
    return points
      .slice()
      .sort((a, b) => Number(a.blockNumber - b.blockNumber))
      .map((p) => {
        const total = p.totalSafeStake + p.totalRugStake;
        return {
          rugPct: total > 0n ? Number((p.totalRugStake * 10000n) / total) / 100 : 50,
          amount: Number(formatEther(p.amount)),
          betRug: p.betRug,
          timestamp: p.timestamp,
        };
      });
  }, [points]);

  if (series.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-[11px] text-[var(--muted)] border border-[var(--line)] bg-[var(--surface-2)]">
        No stakes yet — no price history to plot.
      </div>
    );
  }

  const W = 600;
  const H = 128;
  const PAD = 4;
  const maxAmount = Math.max(...series.map((s) => s.amount), 0.0001);

  const x = (i: number) =>
    series.length === 1 ? W / 2 : PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const y = (pct: number) => PAD + ((100 - pct) / 100) * (H - PAD * 2);

  // Step path: the odds hold flat between trades, because nothing moved them.
  let d = `M ${x(0)} ${y(series[0].rugPct)}`;
  for (let i = 1; i < series.length; i++) {
    d += ` L ${x(i)} ${y(series[i - 1].rugPct)} L ${x(i)} ${y(series[i].rugPct)}`;
  }

  const last = series[series.length - 1];

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-[var(--muted)]">
        <span>IMPLIED RUG PROBABILITY</span>
        <span style={{ color: last.rugPct >= 50 ? "var(--rug)" : "var(--safe)" }}>
          now {last.rugPct.toFixed(1)}%
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full border border-[var(--line)] bg-[var(--surface-2)]"
        role="img"
        aria-label={`Implied rug probability over ${series.length} stakes, currently ${last.rugPct.toFixed(1)} percent`}
      >
        {/* 50% reference — the line where the market has no opinion. */}
        <line x1={0} y1={y(50)} x2={W} y2={y(50)} stroke="var(--line)" strokeDasharray="3 3" />
        <path d={d} fill="none" stroke="var(--acid)" strokeWidth={1.5} />

        {series.map((s, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(s.rugPct)}
            r={2 + Math.min(4, (s.amount / maxAmount) * 4)}
            fill={s.betRug ? "var(--rug)" : "var(--safe)"}
          >
            <title>
              {`${s.amount.toFixed(3)} MON on ${s.betRug ? "RUG" : "SAFE"} → ${s.rugPct.toFixed(1)}% RUG`}
            </title>
          </circle>
        ))}
      </svg>

      <div className="flex justify-between text-[9px] text-[var(--muted)]">
        <span>{series.length} stake{series.length === 1 ? "" : "s"}</span>
        <span>dot size = stake size · 100% = certain rug</span>
      </div>
    </div>
  );
}

import Link from "next/link";
import { formatEther } from "viem";
import { readMarketEvents } from "@/lib/events";
import { chainById } from "@/lib/chains";

export const revalidate = 15;

/// Loop 4 — Warn. The passive, shareable surface: what the crowd just found out,
/// readable by someone who will never stake a cent.

interface FeedItem {
  kind: "resolved_rug" | "resolved_safe" | "new_call" | "big_stake";
  callId: bigint;
  headline: string;
  detail: string;
  color: string;
}

export default async function FeedPage() {
  const events = await readMarketEvents();

  const targets = new Map(events.created.map((c) => [c.callId.toString(), c]));
  const items: FeedItem[] = [];

  for (const r of events.resolved) {
    const c = targets.get(r.callId.toString());
    const chain = c ? chainById(Number(c.chainId))?.label : undefined;
    items.push({
      kind: r.outcomeIsRug ? "resolved_rug" : "resolved_safe",
      callId: r.callId,
      headline: r.outcomeIsRug ? "RUG CONFIRMED" : "SURVIVED THE WINDOW",
      detail: c
        ? `${c.target}${chain ? ` on ${chain}` : ""} — call #${r.callId} resolved ${r.outcomeIsRug ? "RUG" : "SAFE"}.`
        : `Call #${r.callId} resolved ${r.outcomeIsRug ? "RUG" : "SAFE"}.`,
      color: r.outcomeIsRug ? "var(--rug)" : "var(--safe)",
    });
  }

  // Large stakes are newsworthy on their own — someone putting size on RUG is the
  // early-warning signal the whole market layer exists to surface.
  for (const s of events.stakes) {
    if (Number(formatEther(s.amount)) < 1) continue;
    const c = targets.get(s.callId.toString());
    items.push({
      kind: "big_stake",
      callId: s.callId,
      headline: s.betRug ? "SIZE ON RUG" : "SIZE ON SAFE",
      detail: `${Number(formatEther(s.amount)).toFixed(2)} MON staked on ${s.betRug ? "RUG" : "SAFE"}${
        c ? ` for ${c.target}` : ""
      }.`,
      color: s.betRug ? "var(--rug)" : "var(--safe)",
    });
  }

  for (const c of events.created) {
    const chain = chainById(Number(c.chainId))?.label;
    items.push({
      kind: "new_call",
      callId: c.callId,
      headline: "NEW CALL OPEN",
      detail: `${c.target}${chain ? ` on ${chain}` : ""} is now being priced.`,
      color: "var(--acid)",
    });
  }

  // Newest first — call id is a monotonic proxy for time and needs no extra reads.
  items.sort((a, b) => Number(b.callId - a.callId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          Live Feed
          <span className="live-dot text-[var(--acid)] text-xs">●</span>
        </h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          What the market just learned. No wallet needed to read it.
        </p>
      </div>

      {events.degraded && (
        <div className="panel p-4 text-[11px] text-[var(--warn)]">
          Could not read market events — the feed may be incomplete.
        </div>
      )}

      {!events.degraded && items.length === 0 && (
        <div className="panel p-8 text-center text-sm text-[var(--muted)]">
          Nothing has happened yet. Open the first call.
        </div>
      )}

      <div className="space-y-2">
        {items.slice(0, 60).map((item, i) => (
          <Link
            key={`${item.kind}-${item.callId}-${i}`}
            href={`/calls/${item.callId}`}
            className="panel p-4 flex gap-4 items-start hover:border-[var(--muted)] transition-colors"
          >
            <div
              className="w-1 self-stretch shrink-0"
              style={{ background: item.color }}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="text-xs font-bold tracking-wide" style={{ color: item.color }}>
                {item.headline}
              </div>
              <div className="text-[11px] text-[var(--muted)] mt-1 break-all leading-relaxed">
                {item.detail}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

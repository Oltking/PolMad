"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNetwork } from "@/lib/network-context";
import { isDeployed } from "@/lib/networks";
import type { FeedKind } from "@/lib/feed";

interface FeedItemDto {
  id: string;
  kind: FeedKind;
  headline: string;
  detail: string;
  subject?: string;
  callId?: string;
  riskScore?: number;
  timestamp?: number;
  share: string;
}

const STYLE: Record<FeedKind, { color: string; weight: number }> = {
  RUG_CONFIRMED: { color: "var(--rug)", weight: 0 },
  ODDS_SWING: { color: "var(--warn)", weight: 1 },
  BIG_STAKE: { color: "var(--acid)", weight: 2 },
  SAFE_RESOLVED: { color: "var(--safe)", weight: 3 },
  NEW_CALL: { color: "var(--muted)", weight: 4 },
  TOKEN_LAUNCHED: { color: "var(--brand)", weight: 5 },
  FRESH_DEPLOY: { color: "var(--muted)", weight: 6 },
};

const FILTERS: { key: "all" | FeedKind; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "RUG_CONFIRMED", label: "RUGS" },
  { key: "ODDS_SWING", label: "SWINGS" },
  { key: "BIG_STAKE", label: "SIZE" },
  { key: "FRESH_DEPLOY", label: "NEW ON-CHAIN" },
  { key: "TOKEN_LAUNCHED", label: "LAUNCHES" },
];

export default function FeedPage() {
  const { network } = useNetwork();
  const [items, setItems] = useState<FeedItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [filter, setFilter] = useState<"all" | FeedKind>("all");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/feed?chainId=${network.id}`);
        const json = await res.json();
        if (cancelled) return;
        setItems(json.items ?? []);
        setDegraded(!!json.degraded);
      } catch {
        if (!cancelled) setDegraded(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [network.id]);

  const shown = filter === "all" ? items : items.filter((i) => i.kind === filter);
  const anythingDeployed =
    isDeployed(network.deployment.propheyMarket) || isDeployed(network.deployment.tokenFactory);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            Live Feed
            <span className="live-dot text-[var(--acid)] text-xs">●</span>
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Every new contract deployed on {network.label}, scanned automatically — plus what the
            market is pricing. No wallet needed to read it.
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap text-[11px]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-3 py-1 border tracking-widest"
            style={{
              borderColor: filter === f.key ? "var(--acid)" : "var(--line)",
              color: filter === f.key ? "var(--acid)" : "var(--muted)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {degraded && (
        <div className="panel p-4 text-[11px] text-[var(--warn)]">
          Some event sources could not be read — this feed may be incomplete. That is a load
          failure, not a quiet market.
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="panel p-8 text-center text-sm text-[var(--muted)]">Reading the chain…</div>
      )}

      {!loading && shown.length === 0 && (
        <div className="panel p-8 text-center space-y-3">
          <p className="text-sm text-[var(--muted)]">
            {!anythingDeployed && false
              ? `Nothing is deployed on ${network.label} yet.`
              : filter === "all"
                ? "No recent activity found on this network."
                : "No events of this type yet."}
          </p>
          {anythingDeployed && filter === "all" && (
            <div className="flex gap-3 justify-center text-sm">
              <Link href="/calls" className="text-[var(--acid)] hover:underline">
                Open the first call →
              </Link>
              <Link href="/create" className="text-[var(--brand)] hover:underline">
                Launch a token →
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((item) => {
          const style = STYLE[item.kind];
          return (
            <article key={item.id} className="panel p-4 flex gap-4 items-start">
              <div className="w-1 self-stretch shrink-0" style={{ background: style.color }} aria-hidden />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold tracking-wide" style={{ color: style.color }}>
                    {item.headline}
                  </span>
                  {typeof item.riskScore === "number" && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 border"
                      style={{ color: riskColor(item.riskScore), borderColor: riskColor(item.riskScore) }}
                    >
                      RISK {item.riskScore}
                    </span>
                  )}
                  {item.timestamp && (
                    <time className="text-[10px] text-[var(--muted)]">{ago(item.timestamp)}</time>
                  )}
                </div>

                <p className="text-[11px] text-[var(--muted)] mt-1 leading-relaxed break-words">
                  {item.detail}
                </p>

                <div className="flex gap-2 mt-2 flex-wrap">
                  {item.callId && (
                    <Link href={`/calls/${item.callId}`} className="btn-ghost">
                      VIEW CALL
                    </Link>
                  )}
                  {item.subject && (
                    <Link href={`/?chainId=${network.id}&address=${item.subject}`} className="btn-ghost">
                      RISK CHECK
                    </Link>
                  )}
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(item.share)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost"
                  >
                    SHARE ↗
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function riskColor(score: number): string {
  if (score >= 70) return "var(--rug)";
  if (score >= 40) return "var(--warn)";
  return "var(--safe)";
}

function ago(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

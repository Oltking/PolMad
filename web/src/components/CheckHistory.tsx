"use client";

import { useEffect, useState } from "react";
import { chainById } from "@/lib/chains";
import {
  listChecks,
  togglePin,
  removeCheck,
  clearHistory,
  type CheckHistoryEntry,
} from "@/lib/checkHistory";

/// Previously checked contracts. Instant to reopen — the full report is stored, so
/// revisiting costs no RPC calls and no model tokens.
export function CheckHistory({
  onOpen,
  refreshKey,
}: {
  onOpen: (entry: CheckHistoryEntry) => void;
  refreshKey: number;
}) {
  const [entries, setEntries] = useState<CheckHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setEntries(listChecks());
  }, [refreshKey]);

  if (entries.length === 0) return null;

  const shown = expanded ? entries : entries.slice(0, 6);

  return (
    <section className="panel">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
        <h2 className="text-xs tracking-widest text-[var(--muted)]">
          PREVIOUSLY CHECKED ({entries.length})
        </h2>
        <button
          onClick={() => {
            if (confirm("Clear all saved checks? This cannot be undone.")) {
              clearHistory();
              setEntries([]);
            }
          }}
          className="text-[10px] text-[var(--muted)] hover:text-[var(--rug)]"
        >
          CLEAR
        </button>
      </div>

      <ul className="divide-y divide-[var(--line)]">
        {shown.map((e) => {
          const chain = chainById(e.chainId);
          return (
            <li key={`${e.chainId}:${e.address}`} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className="w-9 shrink-0 text-sm font-bold text-center"
                style={{ color: scoreColor(e) }}
                title={e.verdict.replace("_", " ")}
              >
                {e.verdict === "INSUFFICIENT_DATA" ? "—" : e.riskScore}
              </span>

              <button
                onClick={() => onOpen(e)}
                className="min-w-0 flex-1 text-left hover:text-[var(--acid)]"
              >
                <div className="text-xs truncate">
                  {e.contractName || e.symbol || shortAddr(e.address)}
                  {(e.contractName || e.symbol) && (
                    <span className="text-[var(--muted)]"> · {shortAddr(e.address)}</span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--muted)]">
                  {chain?.label ?? `chain ${e.chainId}`} · {ago(e.checkedAt)}
                </div>
              </button>

              <button
                onClick={() => {
                  togglePin(e.chainId, e.address);
                  setEntries(listChecks());
                }}
                className="shrink-0 text-[11px] px-1"
                style={{ color: e.pinned ? "var(--acid)" : "var(--muted)" }}
                title={e.pinned ? "Unpin" : "Pin — pinned checks are never evicted"}
                aria-label={e.pinned ? "Unpin" : "Pin"}
              >
                {e.pinned ? "★" : "☆"}
              </button>
              <button
                onClick={() => {
                  removeCheck(e.chainId, e.address);
                  setEntries(listChecks());
                }}
                className="shrink-0 text-[11px] text-[var(--muted)] hover:text-[var(--rug)] px-1"
                aria-label="Remove"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      {entries.length > 6 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full py-2 text-[10px] text-[var(--muted)] hover:text-[var(--fg)] border-t border-[var(--line)]"
        >
          {expanded ? "SHOW LESS" : `SHOW ALL ${entries.length}`}
        </button>
      )}

      <p className="px-4 py-2 text-[10px] text-[var(--muted)] border-t border-[var(--line)]">
        Stored in this browser only — never sent to a server. What you look up stays yours.
      </p>
    </section>
  );
}

function scoreColor(e: CheckHistoryEntry): string {
  if (e.verdict === "INSUFFICIENT_DATA") return "var(--muted)";
  if (e.riskScore >= 70) return "var(--rug)";
  if (e.riskScore >= 40) return "var(--warn)";
  return "var(--safe)";
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

"use client";

import type { TrustReport } from "./types";

/// Local history of checked contracts.
///
/// Stored in the browser, not on our server. Two reasons, and the second matters
/// more: it makes repeat checks instant, and what a person looks up is genuinely
/// their business. A list of "addresses this user was worried about" is sensitive
/// — it maps to holdings and intentions — so we never collect it centrally.
///
/// Reports are cached with their hash so a stored result can always be shown as
/// exactly the bytes that were attested, and re-checking is one click away.

const KEY = "polmad.checkHistory.v1";
const MAX_ENTRIES = 50;

export interface CheckHistoryEntry {
  chainId: number;
  address: string;
  riskScore: number;
  verdict: TrustReport["verdict"];
  symbol?: string;
  contractName?: string;
  checkedAt: string;
  reportHash: string;
  /// The full report, so revisiting is instant and works offline.
  report: TrustReport;
  pinned?: boolean;
}

function read(): CheckHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CheckHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: CheckHistoryEntry[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded (reports are chunky). Drop the oldest unpinned half and
    // retry once rather than silently losing the whole history.
    try {
      const trimmed = entries.filter((e) => e.pinned).concat(entries.filter((e) => !e.pinned).slice(0, 10));
      window.localStorage.setItem(KEY, JSON.stringify(trimmed));
    } catch {
      /* storage unavailable entirely */
    }
  }
}

const idOf = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

export function listChecks(): CheckHistoryEntry[] {
  return read().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime();
  });
}

export function getCheck(chainId: number, address: string): CheckHistoryEntry | null {
  return read().find((e) => idOf(e.chainId, e.address) === idOf(chainId, address)) ?? null;
}

export function saveCheck(report: TrustReport, reportHash: string): CheckHistoryEntry {
  const entries = read();
  const id = idOf(report.chainId, report.address);
  const existing = entries.find((e) => idOf(e.chainId, e.address) === id);

  const entry: CheckHistoryEntry = {
    chainId: report.chainId,
    address: report.address,
    riskScore: report.riskScore,
    verdict: report.verdict,
    symbol: report.evidence.symbol,
    contractName: report.evidence.contractName,
    checkedAt: report.generatedAt,
    reportHash,
    report,
    // Re-checking must never silently unpin something the user chose to keep.
    pinned: existing?.pinned,
  };

  const next = [entry, ...entries.filter((e) => idOf(e.chainId, e.address) !== id)];
  // Pinned entries are never evicted by the size cap.
  const pinned = next.filter((e) => e.pinned);
  const rest = next.filter((e) => !e.pinned).slice(0, MAX_ENTRIES);
  write([...pinned, ...rest]);

  return entry;
}

export function togglePin(chainId: number, address: string) {
  const entries = read();
  const id = idOf(chainId, address);
  write(entries.map((e) => (idOf(e.chainId, e.address) === id ? { ...e, pinned: !e.pinned } : e)));
}

export function removeCheck(chainId: number, address: string) {
  const id = idOf(chainId, address);
  write(read().filter((e) => idOf(e.chainId, e.address) !== id));
}

export function clearHistory() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

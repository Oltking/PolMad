"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { TrustReportCard } from "@/components/TrustReportCard";
import type { TrustReport } from "@/lib/types";
import { CheckHistory } from "@/components/CheckHistory";
import { saveCheck, getCheck, type CheckHistoryEntry } from "@/lib/checkHistory";

/// Loop 1 — Check. Free, chain-agnostic, no wallet. This page must never require
/// a connection: it is the entire top of the funnel (spec §3.3).

export default function CheckPage() {
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(SUPPORTED_CHAINS[0].id);
  const [report, setReport] = useState<TrustReport | null>(null);
  const [reportHash, setReportHash] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [fromCache, setFromCache] = useState(false);

  // Deep links from the feed, launches list, and launch success screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const a = params.get("address");
    const c = Number(params.get("chainId"));
    if (a) {
      setAddress(a);
      if (SUPPORTED_CHAINS.some((s2) => s2.id === c)) setChainId(c);
      const stored = getCheck(c, a);
      if (stored) {
        setReport(stored.report);
        setReportHash(stored.reportHash);
        setFromCache(true);
      }
    }
  }, []);

  const valid = isAddress(address.trim());

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setError("That is not a valid EVM address.");
      return;
    }
    setLoading(true);
    setError("");
    setReport(null);

    try {
      const res = await fetch(`/api/report?chainId=${chainId}&address=${address.trim()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Report failed");
      setReport(json.report);
      setReportHash(json.reportHash);
      setFromCache(false);
      saveCheck(json.report, json.reportHash);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /// Opening a stored check is instant: the full report was saved, so there is no
  /// RPC round trip and no model call. Re-checking is always one click away.
  function openStored(entry: CheckHistoryEntry) {
    setAddress(entry.address);
    setChainId(entry.chainId);
    setReport(entry.report);
    setReportHash(entry.reportHash);
    setFromCache(true);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function recheck() {
    if (!report) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/report?chainId=${report.chainId}&address=${report.address}&refresh=1`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Report failed");
      setReport(json.report);
      setReportHash(json.reportHash);
      setFromCache(false);
      saveCheck(json.report, json.reportHash);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId);

  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold leading-tight">
          Paste an address. See the score.
          <br />
          <span className="text-[var(--acid)]">Bet on the outcome.</span>
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
          A risk report on any EVM contract, free, no wallet needed. Then — if you have a view worth
          staking on — back it with real MON on Monad, and get paid if you turn out to be right.
        </p>
      </div>

      <form onSubmit={runCheck} className="panel p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--acid)]"
          >
            {SUPPORTED_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… contract address"
            spellCheck={false}
            className="flex-1 min-w-[16rem] bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--acid)]"
          />

          <button
            type="submit"
            disabled={loading || !address.trim()}
            className="px-5 py-2 text-sm font-bold bg-[var(--acid)] text-black disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
          >
            {loading ? "CHECKING…" : "CHECK"}
          </button>
        </div>

        {chain?.coverage === "partial" && (
          <p className="text-[11px] text-[var(--warn)]">
            Limited data coverage on {chain.label}: source verification and holder data are not
            available, so the report leans on on-chain reads alone.
          </p>
        )}

        {address.trim() && !valid && (
          <p className="text-[11px] text-[var(--rug)]">Not a valid EVM address.</p>
        )}
        {error && <p className="text-[11px] text-[var(--rug)]">{error}</p>}
      </form>

      {loading && (
        <div className="panel p-8 text-center text-sm text-[var(--muted)]">
          <span className="live-dot">Reading bytecode, ownership and verification status…</span>
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {fromCache && (
            <div className="panel p-3 flex flex-wrap items-center gap-3 text-[11px]">
              <span className="text-[var(--muted)] flex-1">
                Showing a saved report from {new Date(report.generatedAt).toLocaleString()}. On-chain
                state may have changed since.
              </span>
              <button
                onClick={recheck}
                disabled={loading}
                className="px-3 py-1 border border-[var(--acid)] text-[var(--acid)] hover:bg-[var(--acid)] hover:text-black disabled:opacity-40"
              >
                {loading ? "RE-CHECKING…" : "RE-CHECK NOW"}
              </button>
            </div>
          )}
          <TrustReportCard report={report} reportHash={reportHash} />

          <div className="panel p-4 flex flex-wrap items-center gap-4">
            <div className="text-xs text-[var(--muted)] flex-1 min-w-[14rem]">
              Think the report is wrong — or right? Open a Prophecy Call and let the market price it.
            </div>
            <Link
              href={`/calls?chainId=${report.chainId}&target=${report.address}`}
              className="px-4 py-2 text-sm font-bold border border-[var(--acid)] text-[var(--acid)] hover:bg-[var(--acid)] hover:text-black"
            >
              OPEN A CALL →
            </Link>
          </div>
        </div>
      )}

      <CheckHistory onOpen={openStored} refreshKey={historyKey} />
    </div>
  );
}

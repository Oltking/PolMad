"use client";

import type { TrustReport } from "@/lib/types";
import { chainById } from "@/lib/chains";

const VERDICT_STYLE: Record<TrustReport["verdict"], { label: string; color: string }> = {
  LOW_RISK: { label: "LOW RISK", color: "var(--safe)" },
  ELEVATED: { label: "ELEVATED", color: "var(--warn)" },
  HIGH_RISK: { label: "HIGH RISK", color: "var(--rug)" },
  INSUFFICIENT_DATA: { label: "INSUFFICIENT DATA", color: "var(--muted)" },
};

export function TrustReportCard({ report, reportHash }: { report: TrustReport; reportHash: string }) {
  const verdict = VERDICT_STYLE[report.verdict];
  const chain = chainById(report.chainId);
  const scored = report.verdict !== "INSUFFICIENT_DATA";

  return (
    <section className="panel">
      {/* Headline: score + verdict. The score is deliberately shown as "risk", not
          a grade — a high number is bad, which is the direction people scan for. */}
      <div className="flex flex-wrap items-start gap-6 p-5 border-b border-[var(--line)]">
        <div className="shrink-0">
          <div className="text-[10px] text-[var(--muted)] tracking-widest">RISK SCORE</div>
          <div className="text-5xl font-bold leading-none mt-1" style={{ color: verdict.color }}>
            {scored ? report.riskScore : "—"}
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-1">{scored ? "of 100" : "not scorable"}</div>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="inline-block px-2 py-0.5 text-[10px] tracking-widest border"
            style={{ color: verdict.color, borderColor: verdict.color }}
          >
            {verdict.label}
          </div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--fg)]">{report.summary}</p>
          <div className="mt-3 text-[11px] text-[var(--muted)] break-all">
            {chain?.label} · <span className="text-[var(--fg)]">{report.address}</span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {report.subScores.map((s) => (
          <div key={s.key} className="px-5 py-3 flex flex-wrap gap-x-4 gap-y-2 items-baseline">
            <div className="w-52 shrink-0 text-xs text-[var(--muted)]">{s.label}</div>
            <div className="w-14 shrink-0 text-sm font-bold" style={{ color: barColor(s.score) }}>
              {s.score ?? "n/a"}
            </div>
            {/* A bar is only drawn for a real measurement. An unmeasured category
                renders as text, never as an empty bar that could read as "zero risk". */}
            <div className="flex-1 min-w-[8rem]">
              {s.score !== null ? (
                <div className="h-1.5 bg-[var(--surface-2)]">
                  <div
                    className="h-full"
                    style={{ width: `${s.score}%`, background: barColor(s.score) }}
                  />
                </div>
              ) : (
                <div className="text-[11px] text-[var(--muted)] italic">{s.unavailableReason}</div>
              )}
              {s.findings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {s.findings.map((f, i) => (
                    <li key={i} className="text-[11px] text-[var(--muted)] leading-relaxed">
                      — {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Provenance. A user should always be able to tell whether a model wrote this
          and exactly which bytes were committed on-chain. */}
      <div className="px-5 py-3 border-t border-[var(--line)] text-[10px] text-[var(--muted)] space-y-1">
        <div>
          narrative: {report.model}
          {report.fallbackUsed && " (deterministic fallback — no model output used)"}
        </div>
        <div className="break-all">report hash: {reportHash}</div>
        <div>generated: {new Date(report.generatedAt).toLocaleString()}</div>
      </div>

      {report.evidence.gaps.length > 0 && (
        <details className="px-5 py-3 border-t border-[var(--line)]">
          <summary className="text-[11px] text-[var(--muted)] cursor-pointer">
            What this report could NOT check ({report.evidence.gaps.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {report.evidence.gaps.map((g, i) => (
              <li key={i} className="text-[11px] text-[var(--muted)] leading-relaxed">
                — {g}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function barColor(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 70) return "var(--rug)";
  if (score >= 40) return "var(--warn)";
  return "var(--safe)";
}

import Link from "next/link";
import { isAddress, formatEther } from "viem";
import { readMarketEvents } from "@/lib/events";
import { computeCallerStats } from "@/lib/callerScore";
import { readBadges } from "@/lib/badges";
import { BADGE_NAMES } from "@/lib/contracts";

export const revalidate = 20;

export default async function ProfilePage({ params }: { params: Promise<{ wallet: string }> }) {
  const { wallet } = await params;

  if (!isAddress(wallet)) {
    return <p className="text-sm text-[var(--rug)]">Not a valid wallet address.</p>;
  }

  const events = await readMarketEvents();
  const stats = computeCallerStats(events.stakes, events.resolved).find(
    (s) => s.wallet.toLowerCase() === wallet.toLowerCase(),
  );
  const badges = await readBadges(wallet as `0x${string}`);

  const targets = new Map(events.created.map((c) => [c.callId.toString(), c]));
  const outcomes = new Map(events.resolved.map((r) => [r.callId.toString(), r.outcomeIsRug]));
  const myStakes = events.stakes.filter((s) => s.wallet.toLowerCase() === wallet.toLowerCase());

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="text-[10px] text-[var(--muted)] tracking-widest">CALLER</div>
        <h1 className="text-lg font-bold break-all">{wallet}</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="CALLER SCORE" value={stats ? stats.callerScore.toFixed(2) : "0.00"} accent />
        <Stat label="ACCURACY" value={stats ? `${stats.accuracy}%` : "—"} />
        <Stat label="RESOLVED CALLS" value={stats ? `${stats.correctCalls}/${stats.totalCalls}` : "0"} />
        <Stat label="STREAK" value={stats && stats.streak > 0 ? `${stats.streak}🔥` : "—"} />
      </div>

      <section className="panel p-5 space-y-3">
        <h2 className="text-xs tracking-widest text-[var(--muted)]">BADGES</h2>
        {badges.error ? (
          <p className="text-[11px] text-[var(--warn)]">Could not read badges: {badges.error}</p>
        ) : badges.types.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No badges yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {badges.types.map((t, i) => (
              <span
                key={i}
                className="px-3 py-1.5 text-[11px] border border-[var(--acid)] text-[var(--acid)]"
              >
                {BADGE_NAMES[t] ?? `Badge #${t}`}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="text-xs tracking-widest text-[var(--muted)] px-5 py-3 border-b border-[var(--line)]">
          CALL HISTORY
        </h2>
        {myStakes.length === 0 ? (
          <p className="p-5 text-sm text-[var(--muted)]">No stakes yet.</p>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {myStakes.reverse().map((s, i) => {
              const outcome = outcomes.get(s.callId.toString());
              const target = targets.get(s.callId.toString());
              const settled = outcome !== undefined;
              const won = settled && s.betRug === outcome;

              return (
                <Link
                  key={i}
                  href={`/calls/${s.callId}`}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-[var(--surface-2)]"
                >
                  <span className="text-[10px] text-[var(--muted)] w-10">#{s.callId.toString()}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 border"
                    style={{
                      color: s.betRug ? "var(--rug)" : "var(--safe)",
                      borderColor: s.betRug ? "var(--rug)" : "var(--safe)",
                    }}
                  >
                    {s.betRug ? "RUG" : "SAFE"}
                  </span>
                  <span className="text-xs">{Number(formatEther(s.amount)).toFixed(3)} MON</span>
                  <span className="text-[10px] text-[var(--muted)] truncate flex-1 min-w-[8rem]">
                    {target?.target}
                  </span>
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: !settled ? "var(--muted)" : won ? "var(--safe)" : "var(--rug)" }}
                  >
                    {!settled ? "OPEN" : won ? "WON" : "LOST"}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel p-3">
      <div className="text-[10px] text-[var(--muted)] tracking-widest">{label}</div>
      <div className={`text-xl font-bold mt-1 ${accent ? "text-[var(--acid)]" : ""}`}>{value}</div>
    </div>
  );
}

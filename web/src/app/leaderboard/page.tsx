import Link from "next/link";
import { readMarketEvents } from "@/lib/events";
import { computeCallerStats } from "@/lib/callerScore";

export const revalidate = 20;

export default async function LeaderboardPage() {
  const events = await readMarketEvents();
  const stats = computeCallerStats(events.stakes, events.resolved);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Leaderboard</h1>
        <p className="text-sm text-[var(--muted)] mt-1 max-w-2xl leading-relaxed">
          Caller Score weights a correct call by how few people agreed with you when you staked.
          Calling a rug alone is worth many times more than joining a crowd that was already right.
        </p>
      </div>

      {events.degraded && (
        <div className="panel p-4 text-[11px] text-[var(--warn)]">
          Could not read market events from the RPC — this list may be incomplete. This is a load
          failure, not an empty leaderboard.
        </div>
      )}

      {!events.degraded && stats.length === 0 && (
        <div className="panel p-8 text-center text-sm text-[var(--muted)]">
          No resolved calls yet. Scores appear once calls settle.
        </div>
      )}

      {stats.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-[var(--muted)] tracking-widest border-b border-[var(--line)]">
                <Th>#</Th>
                <Th>CALLER</Th>
                <Th right>SCORE</Th>
                <Th right>CORRECT</Th>
                <Th right>ACCURACY</Th>
                <Th right>STREAK</Th>
                <Th right>VS CROWD</Th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.wallet} className="border-b border-[var(--line)] last:border-0">
                  <Td>
                    <span style={{ color: i < 3 ? "var(--acid)" : undefined }}>{i + 1}</span>
                  </Td>
                  <Td>
                    <Link href={`/profile/${s.wallet}`} className="hover:text-[var(--acid)]">
                      {short(s.wallet)}
                    </Link>
                  </Td>
                  <Td right>
                    <span className="font-bold text-[var(--acid)]">{s.callerScore.toFixed(2)}</span>
                  </Td>
                  <Td right>
                    {s.correctCalls}/{s.totalCalls}
                  </Td>
                  <Td right>{s.accuracy}%</Td>
                  <Td right>{s.streak > 0 ? `${s.streak}🔥` : "—"}</Td>
                  <Td right>{s.contrarianWins || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 font-normal ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-3 py-2 ${right ? "text-right" : "text-left"}`}>{children}</td>;
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

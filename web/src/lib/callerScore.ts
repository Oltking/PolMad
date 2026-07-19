import { formatEther } from "viem";

/// Caller Score — computed off-chain from PropheyMarket events (spec §7.2).
///
/// The weighting is the whole point: a correct call is worth more when fewer people
/// agreed with you at the moment you staked. Piling onto a consensus that turns out
/// right earns very little; being early and alone and right earns a lot.
///
/// Why it matters beyond gamification: it makes the leaderboard resistant to a
/// project rallying its own community to bet SAFE on itself. Mass agreement drives
/// the weight of each agreeing stake toward 1x, while the lone dissenter who called
/// it correctly is scored far higher. Same principle as Community Notes weighting
/// ratings from people who usually disagree.

export interface StakeEvent {
  callId: bigint;
  wallet: `0x${string}`;
  betRug: boolean;
  amount: bigint;
  /// Pool totals immediately after this stake landed — emitted by the contract
  /// precisely so this can be reconstructed without an archive node.
  totalSafeStake: bigint;
  totalRugStake: bigint;
}

export interface ResolvedCall {
  callId: bigint;
  outcomeIsRug: boolean;
}

export interface CallerStats {
  wallet: `0x${string}`;
  callerScore: number;
  correctCalls: number;
  totalCalls: number;
  accuracy: number;
  streak: number;
  /// Won a call while in the minority side at stake time — the AGAINST_THE_CROWD badge.
  contrarianWins: number;
}

/// Cap on the contrarian multiplier. Without it, a stake placed when the winning
/// side held a near-zero fraction of the pool yields an unbounded score — one
/// lucky first-mover would permanently own the leaderboard.
const MAX_MULTIPLIER = 10;

export function computeCallerStats(stakes: StakeEvent[], resolved: ResolvedCall[]): CallerStats[] {
  const outcomes = new Map(resolved.map((r) => [r.callId.toString(), r.outcomeIsRug]));
  const byWallet = new Map<string, CallerStats & { history: { callId: string; won: boolean }[] }>();

  for (const s of stakes) {
    const outcome = outcomes.get(s.callId.toString());
    if (outcome === undefined) continue; // unresolved calls do not score

    const wallet = s.wallet.toLowerCase() as `0x${string}`;
    let entry = byWallet.get(wallet);
    if (!entry) {
      entry = {
        wallet,
        callerScore: 0,
        correctCalls: 0,
        totalCalls: 0,
        accuracy: 0,
        streak: 0,
        contrarianWins: 0,
        history: [],
      };
      byWallet.set(wallet, entry);
    }

    const won = s.betRug === outcome;
    entry.history.push({ callId: s.callId.toString(), won });

    if (won) {
      const total = s.totalSafeStake + s.totalRugStake;
      const winningSide = outcome ? s.totalRugStake : s.totalSafeStake;
      // Fraction of the pool that agreed with this staker at the time they staked.
      const agreement = total > 0n ? Number(winningSide) / Number(total) : 1;
      const multiplier = agreement > 0 ? Math.min(1 / agreement, MAX_MULTIPLIER) : MAX_MULTIPLIER;

      entry.callerScore += Number(formatEther(s.amount)) * multiplier;
      if (agreement < 0.5) entry.contrarianWins += 1;
    }
  }

  return Array.from(byWallet.values())
    .map((e) => {
      // Distinct calls, not distinct stakes — staking three times on one call is
      // one call, or a whale could farm accuracy by splitting a position.
      const perCall = new Map<string, boolean>();
      for (const h of e.history) {
        perCall.set(h.callId, (perCall.get(h.callId) ?? false) || h.won);
      }
      const results = Array.from(perCall.values());
      const correct = results.filter(Boolean).length;

      let streak = 0;
      for (let i = results.length - 1; i >= 0 && results[i]; i--) streak++;

      return {
        wallet: e.wallet,
        callerScore: Math.round(e.callerScore * 100) / 100,
        correctCalls: correct,
        totalCalls: results.length,
        accuracy: results.length ? Math.round((correct / results.length) * 100) : 0,
        streak,
        contrarianWins: e.contrarianWins,
      };
    })
    .sort((a, b) => b.callerScore - a.callerScore);
}

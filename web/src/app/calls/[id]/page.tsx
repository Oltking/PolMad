"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { propheyMarketAbi, BADGE_NAMES } from "@/lib/contracts";
import { chainById } from "@/lib/chains";
import { useNetwork } from "@/lib/network-context";
import { isNetworkLive } from "@/lib/networks";
import { OddsBar, fmt } from "@/components/OddsBar";
import { OddsChart, type StakePoint } from "@/components/OddsChart";
import { StakeModal } from "@/components/StakeModal";
import type { CallData } from "@/hooks/useCalls";

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16: route params arrive as a promise and are unwrapped with `use`.
  const { id } = use(params);
  const callId = BigInt(id);
  const { address } = useAccount();
  const { network } = useNetwork();
  const market = network.deployment.propheyMarket;
  const live = isNetworkLive(network);
  const [staking, setStaking] = useState(false);
  const [badges, setBadges] = useState<{ badgeType: number; txHash: string }[]>([]);
  const [badgeChecked, setBadgeChecked] = useState(false);
  const [history, setHistory] = useState<StakePoint[]>([]);

  const { data: call, refetch } = useReadContract({
    address: market,
    abi: propheyMarketAbi,
    functionName: "getCall",
    args: [callId],
    chainId: network.id,
    query: { enabled: live, refetchInterval: 8_000 },
  });

  const { data: position } = useReadContract({
    address: market,
    abi: propheyMarketAbi,
    functionName: "positionOf",
    args: address ? [callId, address] : undefined,
    chainId: network.id,
    query: { enabled: !!address && live, refetchInterval: 8_000 },
  });

  const { data: payout } = useReadContract({
    address: market,
    abi: propheyMarketAbi,
    functionName: "payoutOf",
    args: address ? [callId, address] : undefined,
    chainId: network.id,
    query: { enabled: !!address && live, refetchInterval: 8_000 },
  });

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess: claimed } = useWaitForTransactionReceipt({ hash: txHash });

  // Odds history for the chart. Refreshed on the same cadence as the call itself.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`/api/call-history?chainId=${network.id}&callId=${callId}`)
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          setHistory(
            (j.points ?? []).map((p: Record<string, string | boolean>) => ({
              blockNumber: BigInt(p.blockNumber as string),
              totalSafeStake: BigInt(p.totalSafeStake as string),
              totalRugStake: BigInt(p.totalRugStake as string),
              amount: BigInt(p.amount as string),
              betRug: p.betRug as boolean,
            })),
          );
        })
        .catch(() => {
          /* chart is supplementary — the live odds bar is the source of truth */
        });
    load();
    const t = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [network.id, callId]);

  /// Milestones are evaluated after a claim, because claiming is the moment a
  /// correct call becomes final. Eligibility is recomputed server-side from
  /// on-chain events — nothing the client sends can influence it.
  useEffect(() => {
    if (!claimed || !address || badgeChecked) return;
    setBadgeChecked(true);
    fetch("/api/badges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: address, chainId: network.id }),
    })
      .then((r) => r.json())
      .then((j) => setBadges(j.minted ?? []))
      .catch(() => {
        /* badges are a reward, never a blocker on getting paid */
      });
  }, [claimed, address, badgeChecked, network.id]);

  if (!live) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No market deployed on {network.label}. Switch networks in the header.
      </p>
    );
  }
  if (!call) {
    return <p className="text-sm text-[var(--muted)]">Loading call #{id}…</p>;
  }

  const c = call as unknown as Omit<CallData, "id">;
  const chain = chainById(Number(c.chainId));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const settled = c.resolved || c.voided;
  const expired = now >= c.windowEnd;

  const [onSafe, onRug, hasClaimed] = (position as readonly [bigint, bigint, boolean] | undefined) ?? [
    0n,
    0n,
    false,
  ];
  const hasPosition = onSafe > 0n || onRug > 0n;
  const claimable = (payout as bigint | undefined) ?? 0n;

  return (
    <div className="space-y-6 max-w-3xl">
      <Link href="/calls" className="text-[11px] text-[var(--muted)] hover:text-[var(--fg)]">
        ← all calls
      </Link>

      <div className="panel p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-[var(--muted)]">
              CALL #{id} · {chain?.label ?? `chain ${c.chainId}`}
            </div>
            <div className="text-sm break-all mt-1">{c.target}</div>
            {chain && (
              <a
                href={`${chain.explorerUrl}/address/${c.target}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[var(--acid)] hover:underline"
              >
                view on {chain.label} explorer ↗
              </a>
            )}
          </div>
          <Outcome call={c} expired={expired} />
        </div>

        <OddsBar safeStake={c.totalSafeStake} rugStake={c.totalRugStake} />

        <OddsChart points={history} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[10px]">
          <Stat label="POOL" value={`${fmt(c.totalSafeStake + c.totalRugStake)} MON`} />
          <Stat label="SAFE SIDE" value={`${fmt(c.totalSafeStake)} MON`} />
          <Stat label="RUG SIDE" value={`${fmt(c.totalRugStake)} MON`} />
          <Stat
            label="WINDOW ENDS"
            value={new Date(Number(c.windowEnd) * 1000).toLocaleString()}
          />
        </div>

        {!settled && !expired && (
          <button
            onClick={() => setStaking(true)}
            className="w-full py-2.5 text-sm font-bold bg-[var(--acid)] text-black hover:brightness-110"
          >
            STAKE ON THIS CALL
          </button>
        )}
      </div>

      {/* Your position + claim. This is Loop 3 — the part that must move real funds. */}
      <div className="panel p-5 space-y-3">
        <h2 className="text-xs tracking-widest text-[var(--muted)]">YOUR POSITION</h2>

        {!address && <p className="text-sm text-[var(--muted)]">Connect a wallet to see your position.</p>}

        {address && !hasPosition && (
          <p className="text-sm text-[var(--muted)]">You have no stake on this call.</p>
        )}

        {address && hasPosition && (
          <>
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              <Stat label="ON SAFE" value={`${fmt(onSafe)} MON`} color="var(--safe)" />
              <Stat label="ON RUG" value={`${fmt(onRug)} MON`} color="var(--rug)" />
            </div>

            {!settled && (
              <p className="text-[11px] text-[var(--muted)]">
                Not settled yet — nothing to claim until the keeper resolves this call.
              </p>
            )}

            {settled && hasClaimed && (
              <p className="text-[11px] text-[var(--safe)]">Already claimed.</p>
            )}

            {settled && !hasClaimed && claimable === 0n && (
              <p className="text-[11px] text-[var(--muted)]">
                Your side lost — there is nothing to claim on this call.
              </p>
            )}

            {settled && !hasClaimed && claimable > 0n && (
              <div className="space-y-2">
                <div className="border border-[var(--acid)] p-3">
                  <div className="text-[10px] text-[var(--muted)]">CLAIMABLE</div>
                  <div className="text-2xl font-bold text-[var(--acid)]">{fmt(claimable)} MON</div>
                  <div className="text-[10px] text-[var(--muted)] mt-1">
                    your stake back, plus your pro-rata share of the losing pool
                  </div>
                </div>
                <button
                  onClick={() =>
                    writeContract({
                      address: market,
                      abi: propheyMarketAbi,
                      functionName: "claim",
                      args: [callId],
                    })
                  }
                  disabled={isPending || confirming}
                  className="w-full py-2.5 text-sm font-bold bg-[var(--acid)] text-black disabled:opacity-40"
                >
                  {isPending ? "CONFIRM IN WALLET…" : confirming ? "PENDING…" : "CLAIM PAYOUT"}
                </button>
              </div>
            )}

            {badges.length > 0 && (
              <div className="border border-[var(--acid)] p-3 space-y-1">
                <div className="text-[10px] tracking-widest text-[var(--acid)]">BADGE EARNED</div>
                {badges.map((b) => (
                  <div key={b.txHash} className="text-[11px]">
                    {BADGE_NAMES[b.badgeType] ?? `Badge #${b.badgeType}`}{" "}
                    <a
                      href={`${network.chain.blockExplorers.default.url}/tx/${b.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--acid)] hover:underline"
                    >
                      ↗
                    </a>
                  </div>
                ))}
                <Link href={`/profile/${address}`} className="text-[10px] text-[var(--muted)] hover:text-[var(--fg)]">
                  view your profile →
                </Link>
              </div>
            )}

            {claimed && (
              <a
                href={`${network.chain.blockExplorers.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] text-[var(--acid)] break-all hover:underline"
              >
                Claimed → {txHash}
              </a>
            )}
            {error && (
              <p className="text-[11px] text-[var(--rug)] break-words">
                {(error as { shortMessage?: string }).shortMessage ?? error.message}
              </p>
            )}
          </>
        )}
      </div>

      {/* If the keeper has gone dark, the escape hatch must be discoverable in the
          UI — not buried in a README nobody reads. */}
      {!settled && expired && now >= c.windowEnd + 604_800n && (
        <div className="panel p-5 space-y-2 border-[var(--warn)]">
          <h2 className="text-xs tracking-widest text-[var(--warn)]">KEEPER DID NOT RESOLVE</h2>
          <p className="text-[11px] text-[var(--muted)]">
            More than 7 days have passed since this window closed with no resolution. Anyone can void
            this call, after which every staker withdraws exactly what they put in.
          </p>
          <button
            onClick={() =>
              writeContract({
                address: market,
                abi: propheyMarketAbi,
                functionName: "voidCall",
                args: [callId],
              })
            }
            className="w-full py-2 text-xs font-bold border border-[var(--warn)] text-[var(--warn)] hover:bg-[var(--warn)] hover:text-black"
          >
            VOID CALL & ENABLE REFUNDS
          </button>
        </div>
      )}

      {staking && (
        <StakeModal
          call={{ ...c, id: callId }}
          onClose={() => setStaking(false)}
          onDone={() => refetch()}
        />
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="border border-[var(--line)] bg-[var(--surface-2)] p-2">
      <div className="text-[var(--muted)]">{label}</div>
      <div className="text-xs mt-0.5" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function Outcome({ call, expired }: { call: Omit<CallData, "id">; expired: boolean }) {
  if (call.voided)
    return <Pill label="VOIDED — REFUNDS OPEN" color="var(--muted)" />;
  if (call.resolved)
    return call.outcomeIsRug ? (
      <Pill label="RESOLVED: RUGGED" color="var(--rug)" />
    ) : (
      <Pill label="RESOLVED: SAFE" color="var(--safe)" />
    );
  if (expired) return <Pill label="AWAITING KEEPER" color="var(--warn)" />;
  return <Pill label="LIVE" color="var(--acid)" />;
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="shrink-0 px-2 py-0.5 text-[10px] border" style={{ color, borderColor: color }}>
      {label}
    </span>
  );
}

"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCalls, type CallData } from "@/hooks/useCalls";
import { useAccount, useReadContracts } from "wagmi";
import { propheyMarketAbi } from "@/lib/contracts";
import { OddsBar, fmt } from "@/components/OddsBar";
import { StakeModal } from "@/components/StakeModal";
import { CreateCallModal } from "@/components/CreateCallModal";
import { chainById } from "@/lib/chains";

export default function CallsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-[var(--muted)]">Loading…</div>}>
      <CallsInner />
    </Suspense>
  );
}

function CallsInner() {
  const params = useSearchParams();
  const { calls, isLoading, deployed, network } = useCalls();
  const [staking, setStaking] = useState<CallData | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<"open" | "settled" | "all" | "mine">("open");
  const { address } = useAccount();

  // Arriving from a Trust Report with a target prefilled.
  const prefillTarget = params.get("target") ?? undefined;
  const prefillChain = params.get("chainId") ? Number(params.get("chainId")) : undefined;

  // Positions for the connected wallet, so "My Calls" does not require the user
  // to remember call ids. One multicall rather than N requests.
  const { data: positions } = useReadContracts({
    contracts: calls.map((c) => ({
      address: network.deployment.propheyMarket,
      abi: propheyMarketAbi,
      functionName: "positionOf" as const,
      args: [c.id, address ?? "0x0000000000000000000000000000000000000000"] as const,
      chainId: network.id,
    })),
    query: { enabled: !!address && calls.length > 0, refetchInterval: 15_000 },
  });

  const myCallIds = new Set(
    (positions ?? []).flatMap((r, i) => {
      if (r.status !== "success") return [];
      const [onSafe, onRug] = r.result as unknown as [bigint, bigint, boolean];
      return onSafe > 0n || onRug > 0n ? [calls[i].id.toString()] : [];
    }),
  );

  const now = BigInt(Math.floor(Date.now() / 1000));
  const shown = calls.filter((c) => {
    const settled = c.resolved || c.voided;
    if (filter === "mine") return myCallIds.has(c.id.toString());
    if (filter === "open") return !settled;
    if (filter === "settled") return settled;
    return true;
  });

  // Claimable positions deserve to be impossible to miss — this is money the user
  // has already won and has not collected.
  const claimable = calls.filter(
    (c) => (c.resolved || c.voided) && myCallIds.has(c.id.toString()),
  );

  if (!deployed) {
    return (
      <div className="panel p-6 space-y-2">
        <h1 className="text-lg font-bold">Not deployed on {network.label}</h1>
        <p className="text-sm text-[var(--muted)]">
          There is no PropheyMarket contract on {network.label} yet
          {network.isTestnet ? "" : " — mainnet has not been launched"}. Switch networks in the
          header, or deploy and set the address in <code>web/.env.local</code>.
        </p>
        <p className="text-[11px] text-[var(--muted)]">
          The Check page works without this — reports never require a deployed market.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Prophecy Calls</h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Live positions on whether a contract rugs inside its window.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-4 py-2 text-sm font-bold bg-[var(--acid)] text-black hover:brightness-110"
        >
          + NEW CALL
        </button>
      </div>

      <div className="flex gap-2 text-[11px]">
        {(["open", "settled", "all", ...(address ? (["mine"] as const) : [])] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1 border tracking-widest uppercase"
            style={{
              borderColor: filter === f ? "var(--acid)" : "var(--line)",
              color: filter === f ? "var(--acid)" : "var(--muted)",
            }}
          >
            {f === "mine" ? `MINE (${myCallIds.size})` : f}
          </button>
        ))}
      </div>

      {claimable.length > 0 && filter !== "mine" && (
        <button
          onClick={() => setFilter("mine")}
          className="w-full panel p-3 text-left text-[11px] border-[var(--acid)] hover:brightness-125"
        >
          <span className="text-[var(--acid)] font-bold">
            You have {claimable.length} settled call{claimable.length === 1 ? "" : "s"}
          </span>
          <span className="text-[var(--muted)]"> — check whether there is a payout to claim →</span>
        </button>
      )}

      {isLoading && <div className="panel p-8 text-center text-sm text-[var(--muted)]">Reading calls…</div>}

      {!isLoading && shown.length === 0 && (
        <div className="panel p-8 text-center space-y-2">
          <p className="text-sm text-[var(--muted)]">No {filter} calls.</p>
          <button onClick={() => setCreating(true)} className="text-sm text-[var(--acid)] hover:underline">
            Open the first one →
          </button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((c) => (
          <CallCard key={c.id.toString()} call={c} now={now} onStake={() => setStaking(c)} />
        ))}
      </div>

      {staking && <StakeModal call={staking} onClose={() => setStaking(null)} />}
      {creating && (
        <CreateCallModal
          onClose={() => setCreating(false)}
          prefillTarget={prefillTarget}
          prefillChain={prefillChain}
        />
      )}
    </div>
  );
}

function CallCard({ call, now, onStake }: { call: CallData; now: bigint; onStake: () => void }) {
  const chain = chainById(Number(call.chainId));
  const settled = call.resolved || call.voided;
  const expired = now >= call.windowEnd;

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] text-[var(--muted)]">
            #{call.id.toString()} · {chain?.label ?? `chain ${call.chainId}`}
          </div>
          <Link
            href={`/calls/${call.id}`}
            className="text-xs break-all hover:text-[var(--acid)] transition-colors"
          >
            {call.target}
          </Link>
        </div>
        <StatusPill call={call} expired={expired} />
      </div>

      <OddsBar safeStake={call.totalSafeStake} rugStake={call.totalRugStake} />

      <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
        <span>pool {fmt(call.totalSafeStake + call.totalRugStake)} MON</span>
        <span>{settled ? "settled" : expired ? "awaiting resolution" : timeLeft(call.windowEnd, now)}</span>
      </div>

      {!settled && !expired && (
        <button
          onClick={onStake}
          className="w-full py-2 text-xs font-bold border border-[var(--acid)] text-[var(--acid)] hover:bg-[var(--acid)] hover:text-black"
        >
          STAKE
        </button>
      )}
      {settled && (
        <Link
          href={`/calls/${call.id}`}
          className="block text-center w-full py-2 text-xs font-bold border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]"
        >
          VIEW / CLAIM
        </Link>
      )}
    </div>
  );
}

function StatusPill({ call, expired }: { call: CallData; expired: boolean }) {
  let label: string;
  let color: string;

  if (call.voided) {
    label = "VOIDED";
    color = "var(--muted)";
  } else if (call.resolved) {
    label = call.outcomeIsRug ? "RUGGED" : "SAFE";
    color = call.outcomeIsRug ? "var(--rug)" : "var(--safe)";
  } else if (expired) {
    label = "RESOLVING";
    color = "var(--warn)";
  } else {
    label = "LIVE";
    color = "var(--acid)";
  }

  return (
    <span
      className={`shrink-0 px-2 py-0.5 text-[10px] border ${label === "LIVE" ? "live-dot" : ""}`}
      style={{ color, borderColor: color }}
    >
      {label}
    </span>
  );
}

function timeLeft(end: bigint, now: bigint): string {
  const s = Number(end - now);
  if (s <= 0) return "window closed";
  const h = Math.floor(s / 3600);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h ${Math.floor((s % 3600) / 60)}m left`;
  return `${Math.floor(s / 60)}m left`;
}

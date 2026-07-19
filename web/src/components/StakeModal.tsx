"use client";

import { useState } from "react";
import { parseEther, formatEther } from "viem";
import { useAccount, useEstimateGas, useWaitForTransactionReceipt, useWriteContract, useBalance } from "wagmi";
import { encodeFunctionData } from "viem";
import { PROPHEY_MARKET, propheyMarketAbi } from "@/lib/contracts";
import { monadTestnet } from "@/lib/chains";
import { OddsBar, fmt } from "./OddsBar";
import type { CallData } from "@/hooks/useCalls";

const MIN_STAKE_MON = 0.01;

/// Stake modal. Two rules it must never break, per the spec's safety rails:
///   - show the exact contract address being called before the user signs
///   - show a real gas estimate, because Monad charges on gas_limit not gas used,
///     so a sloppy limit costs the user real money
export function StakeModal({
  call,
  onClose,
  onDone,
}: {
  call: CallData;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { address, chainId } = useAccount();
  const [side, setSide] = useState<"safe" | "rug" | null>(null);
  const [amount, setAmount] = useState("0.1");

  const { data: balance } = useBalance({ address });
  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const parsed = safeParse(amount);
  const wrongChain = chainId !== monadTestnet.id;
  const belowMin = parsed !== null && parsed < parseEther(String(MIN_STAKE_MON));
  const overBalance = parsed !== null && balance ? parsed > balance.value : false;

  // Gas is estimated against the real calldata so the number shown is the number
  // that will be charged, not a guess.
  const { data: gasEstimate } = useEstimateGas({
    to: PROPHEY_MARKET,
    value: parsed ?? 0n,
    data: side
      ? encodeFunctionData({
          abi: propheyMarketAbi,
          functionName: "stake",
          args: [call.id, side === "rug"],
        })
      : undefined,
    query: { enabled: !!side && parsed !== null && !wrongChain && !overBalance },
  });

  const canSubmit =
    !!side && parsed !== null && !belowMin && !overBalance && !wrongChain && !isPending && !confirming;

  function submit() {
    if (!canSubmit || !side || parsed === null) return;
    writeContract({
      address: PROPHEY_MARKET,
      abi: propheyMarketAbi,
      functionName: "stake",
      args: [call.id, side === "rug"],
      value: parsed,
      // 20% headroom over the estimate: enough for state that shifts between
      // estimate and inclusion, without overpaying on a gas_limit-charged chain.
      gas: gasEstimate ? (gasEstimate * 120n) / 100n : undefined,
    });
  }

  if (isSuccess) {
    return (
      <Shell onClose={onClose} title="POSITION OPEN">
        <div className="space-y-4">
          <p className="text-sm">
            Staked{" "}
            <span className="font-bold" style={{ color: side === "rug" ? "var(--rug)" : "var(--safe)" }}>
              {amount} MON on {side?.toUpperCase()}
            </span>{" "}
            for call #{call.id.toString()}.
          </p>
          <a
            href={`${monadTestnet.blockExplorers.default.url}/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="block text-[11px] text-[var(--acid)] break-all hover:underline"
          >
            {txHash}
          </a>
          <p className="text-[11px] text-[var(--muted)]">
            Nothing to do now but wait. If a rug trigger fires the keeper resolves immediately;
            otherwise this settles SAFE when the window closes.
          </p>
          <button
            onClick={() => {
              onDone?.();
              onClose();
            }}
            className="w-full py-2 text-sm font-bold bg-[var(--acid)] text-black"
          >
            DONE
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title={`STAKE ON CALL #${call.id.toString()}`}>
      <div className="space-y-4">
        <div>
          <div className="text-[10px] text-[var(--muted)] tracking-widest mb-1">CURRENT ODDS</div>
          <OddsBar safeStake={call.totalSafeStake} rugStake={call.totalRugStake} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SideButton
            active={side === "safe"}
            color="var(--safe)"
            label="SAFE"
            sub="No rug trigger fires"
            onClick={() => setSide("safe")}
          />
          <SideButton
            active={side === "rug"}
            color="var(--rug)"
            label="RUG"
            sub="A trigger fires in window"
            onClick={() => setSide("rug")}
          />
        </div>

        <div>
          <label className="text-[10px] text-[var(--muted)] tracking-widest">STAKE (MON)</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--acid)]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
            <span>min {MIN_STAKE_MON} MON</span>
            {balance && <span>balance {fmt(balance.value)} MON</span>}
          </div>
        </div>

        {/* Exact target of the transaction, always visible before signing. */}
        <div className="border border-[var(--line)] bg-[var(--surface-2)] p-3 space-y-1 text-[10px]">
          <Row label="contract" value={PROPHEY_MARKET} mono />
          <Row label="function" value={`stake(${call.id}, ${side === "rug"})`} />
          <Row label="value" value={`${amount || "0"} MON`} />
          <Row
            label="est. gas"
            value={gasEstimate ? `${gasEstimate.toString()} units` : side ? "estimating…" : "pick a side"}
          />
          <Row label="network" value="Monad Testnet (10143)" />
        </div>

        {wrongChain && (
          <p className="text-[11px] text-[var(--warn)]">
            Wrong network. Switch your wallet to Monad Testnet to stake.
          </p>
        )}
        {parsed === null && amount !== "" && (
          <p className="text-[11px] text-[var(--rug)]">Enter a valid amount.</p>
        )}
        {belowMin && <p className="text-[11px] text-[var(--rug)]">Minimum stake is {MIN_STAKE_MON} MON.</p>}
        {overBalance && <p className="text-[11px] text-[var(--rug)]">That is more than your balance.</p>}
        {error && (
          <p className="text-[11px] text-[var(--rug)] break-words">
            {(error as { shortMessage?: string }).shortMessage ?? error.message}
          </p>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full py-2.5 text-sm font-bold bg-[var(--acid)] text-black disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? "CONFIRM IN WALLET…" : confirming ? "PENDING…" : "STAKE"}
        </button>

        <p className="text-[10px] text-[var(--muted)] leading-relaxed">
          Staking is irreversible. If your side loses, your stake goes to the winners. If the keeper
          fails to resolve within 7 days of the window closing, anyone can void the call and everyone
          withdraws their original stake.
        </p>
      </div>
    </Shell>
  );
}

function SideButton({
  active,
  color,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  color: string;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="p-3 text-left border transition-colors"
      style={{
        borderColor: active ? color : "var(--line)",
        background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--surface-2)",
      }}
    >
      <div className="text-sm font-bold" style={{ color }}>
        {label}
      </div>
      <div className="text-[10px] text-[var(--muted)] mt-0.5">{sub}</div>
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--muted)]">{label}</span>
      <span className={`text-right ${mono ? "break-all" : ""}`}>{value}</span>
    </div>
  );
}

function Shell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="panel w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
          <h2 className="text-xs tracking-widest text-[var(--acid)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)] text-lg leading-none">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function safeParse(v: string): bigint | null {
  try {
    const parsed = parseEther(v.trim());
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

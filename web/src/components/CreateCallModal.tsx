"use client";

import { useState } from "react";
import { isAddress, getAddress } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { PROPHEY_MARKET, propheyMarketAbi } from "@/lib/contracts";
import { SUPPORTED_CHAINS, monadTestnet } from "@/lib/chains";

/// Window presets. 72h is the spec default; the shorter options exist because a
/// hackathon demo cannot wait three days, and the contract allows anything from
/// 1 hour to 30 days.
const WINDOWS = [
  { label: "1 hour", seconds: 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "72 hours (default)", seconds: 259_200 },
  { label: "7 days", seconds: 604_800 },
];

export function CreateCallModal({
  onClose,
  prefillTarget,
  prefillChain,
}: {
  onClose: () => void;
  prefillTarget?: string;
  prefillChain?: number;
}) {
  const { chainId: walletChain } = useAccount();
  const [target, setTarget] = useState(prefillTarget ?? "");
  const [targetChain, setTargetChain] = useState(prefillChain ?? SUPPORTED_CHAINS[0].id);
  const [windowSeconds, setWindowSeconds] = useState(259_200);

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const valid = isAddress(target.trim());
  const wrongChain = walletChain !== monadTestnet.id;

  function submit() {
    if (!valid) return;
    writeContract({
      address: PROPHEY_MARKET,
      abi: propheyMarketAbi,
      functionName: "createCall",
      args: [BigInt(targetChain), getAddress(target.trim()), BigInt(windowSeconds)],
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line)]">
          <h2 className="text-xs tracking-widest text-[var(--acid)]">OPEN A PROPHECY CALL</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--fg)] text-lg leading-none">
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          {isSuccess ? (
            <>
              <p className="text-sm">Call created. It is now open for staking.</p>
              <a
                href={`${monadTestnet.blockExplorers.default.url}/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] text-[var(--acid)] break-all hover:underline"
              >
                {txHash}
              </a>
              <button onClick={onClose} className="w-full py-2 text-sm font-bold bg-[var(--acid)] text-black">
                DONE
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-[10px] text-[var(--muted)] tracking-widest">TARGET CHAIN</label>
                <select
                  value={targetChain}
                  onChange={(e) => setTargetChain(Number(e.target.value))}
                  className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--acid)]"
                >
                  {SUPPORTED_CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] text-[var(--muted)] tracking-widest">TARGET CONTRACT</label>
                <input
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--acid)]"
                />
              </div>

              <div>
                <label className="text-[10px] text-[var(--muted)] tracking-widest">WINDOW</label>
                <select
                  value={windowSeconds}
                  onChange={(e) => setWindowSeconds(Number(e.target.value))}
                  className="mt-1 w-full bg-[var(--surface-2)] border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-[var(--acid)]"
                >
                  {WINDOWS.map((w) => (
                    <option key={w.seconds} value={w.seconds}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border border-[var(--line)] bg-[var(--surface-2)] p-3 text-[10px] text-[var(--muted)] leading-relaxed">
                Resolves RUG only if, within the window, the target shows one of: a &gt;50%
                single-transaction liquidity pull, &gt;20% supply inflation via mint, or a
                transfer-blocking pause/blacklist. Otherwise it resolves SAFE.
              </div>

              {wrongChain && (
                <p className="text-[11px] text-[var(--warn)]">
                  Switch your wallet to Monad Testnet — calls live on Monad regardless of the target
                  chain.
                </p>
              )}
              {target.trim() && !valid && (
                <p className="text-[11px] text-[var(--rug)]">Not a valid EVM address.</p>
              )}
              {error && (
                <p className="text-[11px] text-[var(--rug)] break-words">
                  {(error as { shortMessage?: string }).shortMessage ?? error.message}
                </p>
              )}

              <button
                onClick={submit}
                disabled={!valid || wrongChain || isPending || confirming}
                className="w-full py-2.5 text-sm font-bold bg-[var(--acid)] text-black disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPending ? "CONFIRM IN WALLET…" : confirming ? "PENDING…" : "CREATE CALL"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

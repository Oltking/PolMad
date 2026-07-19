"use client";

import { useEffect } from "react";

/// Route-level error boundary. Without this, one bad RPC response blanks the whole
/// page — which on a risk tool is worse than useless, because a blank screen tells
/// a user nothing about whether the contract they were checking is safe.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[polmad] route error:", error);
  }, [error]);

  return (
    <div className="panel p-6 space-y-3 max-w-2xl">
      <h1 className="text-lg font-bold text-[var(--rug)]">Something broke on this page</h1>
      <p className="text-sm text-[var(--muted)] leading-relaxed">
        This is our bug, not a verdict on any contract. Nothing here should be read as a safety
        signal — if you were checking an address, treat it as unchecked.
      </p>
      <p className="text-[11px] text-[var(--muted)] break-words font-mono">{error.message}</p>
      <div className="flex gap-2">
        <button onClick={reset} className="px-4 py-2 text-sm font-bold bg-[var(--acid)] text-black">
          TRY AGAIN
        </button>
        <a href="/" className="px-4 py-2 text-sm border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]">
          BACK TO CHECK
        </a>
      </div>
    </div>
  );
}

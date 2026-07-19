"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import { tokenFactoryAbi } from "@/lib/contracts";
import { isDeployed } from "@/lib/networks";

interface LaunchRow {
  token: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  symbol: string;
  supply: bigint;
  timestamp: bigint;
}

/// Public directory of everything launched here. Doubles as proof of the safety
/// claim: every token in this list came from the same factory, so every one of
/// them is backdoor-free by construction.
export default function LaunchesPage() {
  const { network } = useNetwork();
  const { address } = useAccount();
  const factory = network.deployment.tokenFactory;
  const live = isDeployed(factory);

  const { data, isLoading } = useReadContract({
    address: factory,
    abi: tokenFactoryAbi,
    functionName: "recentLaunches",
    args: [0n, 50n],
    chainId: network.id,
    query: { enabled: live, refetchInterval: 15_000 },
  });

  const launches = (data as readonly LaunchRow[] | undefined) ?? [];
  const mine = address ? launches.filter((l) => l.creator.toLowerCase() === address.toLowerCase()) : [];

  if (!live) {
    return (
      <div className="panel p-6 space-y-2">
        <h1 className="text-lg font-bold">Launchpad not deployed on {network.label}</h1>
        <p className="text-sm text-[var(--muted)]">
          Switch networks in the header, or deploy TokenFactory and set{" "}
          <code>NEXT_PUBLIC_TOKEN_FACTORY</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">Launches</h1>
          <p className="text-sm text-[var(--muted)] mt-1 max-w-xl leading-relaxed">
            Every token here was deployed by the same factory, so none of them has a mint function,
            an owner, or a pause switch. Verify any of them yourself — that is the point.
          </p>
        </div>
        <Link href="/create" className="px-4 py-2 text-sm font-bold bg-[var(--acid)] text-black">
          + LAUNCH TOKEN
        </Link>
      </div>

      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs tracking-widest text-[var(--acid)]">YOUR LAUNCHES</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {mine.map((l) => (
              <LaunchCard key={l.token} launch={l} explorer={network.chain.blockExplorers.default.url} chainId={network.id} own />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-xs tracking-widest text-[var(--muted)]">ALL LAUNCHES</h2>

        {isLoading && <div className="panel p-8 text-center text-sm text-[var(--muted)]">Reading launches…</div>}

        {!isLoading && launches.length === 0 && (
          <div className="panel p-8 text-center space-y-2">
            <p className="text-sm text-[var(--muted)]">Nothing launched yet.</p>
            <Link href="/create" className="text-sm text-[var(--acid)] hover:underline">
              Be the first →
            </Link>
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-2">
          {launches.map((l) => (
            <LaunchCard key={l.token} launch={l} explorer={network.chain.blockExplorers.default.url} chainId={network.id} />
          ))}
        </div>
      </section>
    </div>
  );
}

function LaunchCard({
  launch,
  explorer,
  chainId,
  own,
}: {
  launch: LaunchRow;
  explorer: string;
  chainId: number;
  own?: boolean;
}) {
  return (
    <div className="panel p-4 space-y-2" style={own ? { borderColor: "var(--acid)" } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">
            {launch.name} <span className="text-[var(--muted)]">${launch.symbol}</span>
          </div>
          <div className="text-[10px] text-[var(--muted)] break-all mt-0.5">{launch.token}</div>
        </div>
        <span
          className="shrink-0 px-2 py-0.5 text-[10px] border"
          style={{ color: "var(--safe)", borderColor: "var(--safe)" }}
          title="No mint, no owner, no pause — guaranteed by the factory"
        >
          NO BACKDOOR
        </span>
      </div>

      <div className="flex justify-between text-[10px] text-[var(--muted)]">
        <span>supply {Number(formatUnits(launch.supply, 18)).toLocaleString()}</span>
        <span>{new Date(Number(launch.timestamp) * 1000).toLocaleDateString()}</span>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Link href={`/?chainId=${chainId}&address=${launch.token}`} className="btn-ghost">
          RISK CHECK
        </Link>
        <a href={`${explorer}/address/${launch.token}`} target="_blank" rel="noreferrer" className="btn-ghost">
          EXPLORER ↗
        </a>
        <Link href={`/calls?chainId=${chainId}&target=${launch.token}`} className="btn-ghost">
          OPEN CALL
        </Link>
      </div>
    </div>
  );
}

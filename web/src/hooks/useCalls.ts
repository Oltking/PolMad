"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { propheyMarketAbi } from "@/lib/contracts";
import { useNetwork } from "@/lib/network-context";
import { isNetworkLive } from "@/lib/networks";

export interface CallData {
  id: bigint;
  chainId: bigint;
  target: `0x${string}`;
  creator: `0x${string}`;
  windowEnd: bigint;
  totalSafeStake: bigint;
  totalRugStake: bigint;
  resolved: boolean;
  outcomeIsRug: boolean;
  voided: boolean;
}

/// Reads every Call from the market on the *currently selected* network. Every read
/// pins `chainId` explicitly so a stale wallet connection can never cause testnet
/// data to render as mainnet data (or the reverse).
///
/// N+1 eth_calls is a deliberate hackathon-scope choice over an indexer: fine at
/// demo volume, no infrastructure to go stale. Replace this hook alone when it isn't.
export function useCalls() {
  const { network } = useNetwork();
  const market = network.deployment.propheyMarket;
  const live = isNetworkLive(network);

  const { data: count, isLoading: loadingCount } = useReadContract({
    address: market,
    abi: propheyMarketAbi,
    functionName: "callCount",
    chainId: network.id,
    query: { enabled: live, refetchInterval: 10_000 },
  });

  const ids = count ? Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)) : [];

  const { data, isLoading } = useReadContracts({
    contracts: ids.map((id) => ({
      address: market,
      abi: propheyMarketAbi,
      functionName: "getCall" as const,
      args: [id] as const,
      chainId: network.id,
    })),
    query: { enabled: live && ids.length > 0, refetchInterval: 10_000 },
  });

  const calls: CallData[] = (data ?? []).flatMap((r, i) => {
    if (r.status !== "success" || !r.result) return [];
    const c = r.result as unknown as Omit<CallData, "id">;
    return [{ ...c, id: ids[i] }];
  });

  return { calls, isLoading: loadingCount || isLoading, deployed: live, network };
}

/// Pool split as a percentage on the RUG side. Null for an empty market — 50/50
/// would be a fabricated price for a market nobody has traded.
export function rugOdds(call: Pick<CallData, "totalSafeStake" | "totalRugStake">): number | null {
  const total = call.totalSafeStake + call.totalRugStake;
  if (total === 0n) return null;
  return Number((call.totalRugStake * 10000n) / total) / 100;
}

"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { PROPHEY_MARKET, propheyMarketAbi, isDeployed } from "@/lib/contracts";

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

/// Reads every Call straight from the contract.
///
/// This is a deliberate hackathon-scope choice over an indexer: N+1 eth_calls is
/// fine at demo volume and has no infrastructure to go stale or lie. It will not
/// scale past a few hundred Calls — at that point the events are already there to
/// index (spec §8), and only this hook needs replacing.
export function useCalls() {
  const deployed = isDeployed(PROPHEY_MARKET);

  const { data: count, isLoading: loadingCount } = useReadContract({
    address: PROPHEY_MARKET,
    abi: propheyMarketAbi,
    functionName: "callCount",
    query: { enabled: deployed, refetchInterval: 10_000 },
  });

  const ids = count ? Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)) : [];

  const { data, isLoading } = useReadContracts({
    contracts: ids.map((id) => ({
      address: PROPHEY_MARKET,
      abi: propheyMarketAbi,
      functionName: "getCall" as const,
      args: [id] as const,
    })),
    query: { enabled: deployed && ids.length > 0, refetchInterval: 10_000 },
  });

  const calls: CallData[] = (data ?? []).flatMap((r, i) => {
    if (r.status !== "success" || !r.result) return [];
    const c = r.result as unknown as Omit<CallData, "id">;
    return [{ ...c, id: ids[i] }];
  });

  return {
    calls,
    isLoading: loadingCount || isLoading,
    deployed,
  };
}

/// Pool split as a percentage on the RUG side. Returns null for an empty market —
/// 50/50 would be a fabricated price for a market nobody has traded.
export function rugOdds(call: Pick<CallData, "totalSafeStake" | "totalRugStake">): number | null {
  const total = call.totalSafeStake + call.totalRugStake;
  if (total === 0n) return null;
  return Number((call.totalRugStake * 10000n) / total) / 100;
}

import { createPublicClient, http, type Address } from "viem";
import { verifierBadgeAbi } from "./contracts";
import { networkFor, isDeployed, DEFAULT_STAKING_CHAIN, type StakingChainId } from "./networks";

/// Badge types held by a wallet. Returns an explicit error string rather than an
/// empty list on failure — "we couldn't check" and "you have none" look identical
/// to a user otherwise, and only one of them is a reason to retry.
export async function readBadges(
  wallet: Address,
  chainId: StakingChainId = DEFAULT_STAKING_CHAIN,
): Promise<{ types: number[]; error?: string }> {
  const network = networkFor(chainId);
  const badgeContract = network.deployment.verifierBadge;
  if (!isDeployed(badgeContract)) return { types: [] };

  const client = createPublicClient({
    chain: network.chain,
    transport: http(network.chain.rpcUrls.default.http[0]),
  });

  try {
    const tokenIds = await client.readContract({
      address: badgeContract,
      abi: verifierBadgeAbi,
      functionName: "badgesOf",
      args: [wallet],
    });

    const types = await Promise.all(
      (tokenIds as readonly bigint[]).map((id) =>
        client.readContract({
          address: badgeContract,
          abi: verifierBadgeAbi,
          functionName: "badgeTypeOf",
          args: [id],
        }),
      ),
    );

    return { types: types.map((t) => Number(t)) };
  } catch (err) {
    return { types: [], error: (err as Error).message };
  }
}

import { createPublicClient, http, type Address } from "viem";
import { monadTestnet } from "./chains";
import { VERIFIER_BADGE, verifierBadgeAbi, isDeployed } from "./contracts";

const client = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0]),
});

/// Badge types held by a wallet. Returns an explicit error string rather than an
/// empty list on failure — "we couldn't check" and "you have none" look identical
/// to a user otherwise, and only one of them is a reason to retry.
export async function readBadges(
  wallet: Address,
): Promise<{ types: number[]; error?: string }> {
  if (!isDeployed(VERIFIER_BADGE)) return { types: [] };

  try {
    const tokenIds = await client.readContract({
      address: VERIFIER_BADGE,
      abi: verifierBadgeAbi,
      functionName: "badgesOf",
      args: [wallet],
    });

    const types = await Promise.all(
      (tokenIds as readonly bigint[]).map((id) =>
        client.readContract({
          address: VERIFIER_BADGE,
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

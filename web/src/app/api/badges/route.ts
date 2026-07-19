import { createWalletClient, createPublicClient, http, isAddress, getAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { networkFor, isDeployed, DEFAULT_STAKING_CHAIN, type StakingChainId } from "@/lib/networks";
import { readMarketEvents } from "@/lib/events";
import { computeCallerStats } from "@/lib/callerScore";

/// POST /api/badges  { wallet }
///
/// Milestones are computed here from on-chain events, then minted by the backend
/// minter key. Two properties this must hold:
///   - eligibility is derived from events, never from anything the caller sends
///   - the contract itself rejects duplicate mints, so this endpoint being called
///     repeatedly (or by anyone) cannot inflate someone's badge count

const mintAbi = parseAbi([
  "function mintBadge(address to, uint256 badgeType) returns (uint256)",
  "function hasBadge(address wallet, uint256 badgeType) view returns (bool)",
]);

const FIRST_CORRECT_CALL = 0;
const FIVE_CALL_STREAK = 1;
const AGAINST_THE_CROWD = 2;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const wallet = body?.wallet;

  if (!wallet || !isAddress(wallet)) {
    return Response.json({ error: "Valid `wallet` required" }, { status: 400 });
  }
  const chainId = (Number(body?.chainId) || DEFAULT_STAKING_CHAIN) as StakingChainId;
  const network = networkFor(chainId);
  const badgeContract = network.deployment.verifierBadge;
  if (!isDeployed(badgeContract)) {
    return Response.json({ error: `VerifierBadge not deployed on ${network.label}` }, { status: 503 });
  }

  const minterKey = process.env.BADGE_MINTER_PRIVATE_KEY;
  if (!minterKey) {
    return Response.json({ error: "Minting not configured" }, { status: 503 });
  }

  const address = getAddress(wallet);
  const events = await readMarketEvents(chainId);
  if (events.degraded) {
    // Never mint off incomplete data — a partial event sweep could award a badge
    // that the full history does not support.
    return Response.json({ error: "Event data unavailable; refusing to mint" }, { status: 503 });
  }

  const stats = computeCallerStats(events.stakes, events.resolved).find(
    (s) => s.wallet.toLowerCase() === address.toLowerCase(),
  );
  if (!stats) return Response.json({ minted: [], eligible: [] });

  const eligible: number[] = [];
  if (stats.correctCalls >= 1) eligible.push(FIRST_CORRECT_CALL);
  if (stats.streak >= 5) eligible.push(FIVE_CALL_STREAK);
  if (stats.contrarianWins >= 1) eligible.push(AGAINST_THE_CROWD);

  const account = privateKeyToAccount(minterKey as `0x${string}`);
  const rpc = network.chain.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: network.chain, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: network.chain, transport: http(rpc) });

  const minted: { badgeType: number; txHash: string }[] = [];

  for (const badgeType of eligible) {
    const already = await publicClient.readContract({
      address: badgeContract,
      abi: mintAbi,
      functionName: "hasBadge",
      args: [address, BigInt(badgeType)],
    });
    if (already) continue;

    try {
      const txHash = await walletClient.writeContract({
        address: badgeContract,
        abi: mintAbi,
        functionName: "mintBadge",
        args: [address, BigInt(badgeType)],
      });
      minted.push({ badgeType, txHash });
    } catch (err) {
      console.warn(`[badges] mint ${badgeType} for ${address} failed:`, (err as Error).message);
    }
  }

  return Response.json({ eligible, minted, stats });
}

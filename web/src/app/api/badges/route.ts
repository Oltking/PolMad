import { createWalletClient, createPublicClient, http, isAddress, getAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "@/lib/chains";
import { VERIFIER_BADGE, isDeployed } from "@/lib/contracts";
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
  if (!isDeployed(VERIFIER_BADGE)) {
    return Response.json({ error: "VerifierBadge not deployed" }, { status: 503 });
  }

  const minterKey = process.env.BADGE_MINTER_PRIVATE_KEY;
  if (!minterKey) {
    return Response.json({ error: "Minting not configured" }, { status: 503 });
  }

  const address = getAddress(wallet);
  const events = await readMarketEvents();
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
  const rpc = process.env.MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(rpc) });

  const minted: { badgeType: number; txHash: string }[] = [];

  for (const badgeType of eligible) {
    const already = await publicClient.readContract({
      address: VERIFIER_BADGE,
      abi: mintAbi,
      functionName: "hasBadge",
      args: [address, BigInt(badgeType)],
    });
    if (already) continue;

    try {
      const txHash = await walletClient.writeContract({
        address: VERIFIER_BADGE,
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

import { createWalletClient, createPublicClient, http, getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { trustRegistryAbi } from "./contracts";
import {
  networkFor,
  isDeployed,
  DEFAULT_STAKING_CHAIN,
  type StakingChainId,
} from "./networks";

/// Writes report hashes to TrustRegistry.
///
/// This is what makes a report more than a webpage: the hash of the exact JSON a
/// user was shown is committed on-chain, so anyone can later prove what this app
/// said about a contract at a point in time — including proving it said something
/// different from what a screenshot claims.
///
/// The registry lives on the staking network; the *target* may be on any chain,
/// which is why chainId is a field rather than implied.
///
/// Attestation is best-effort and must never block or fail a report. A user asking
/// "is this safe?" gets their answer whether or not our signer has gas.

const DEDUPE_MS = 10 * 60 * 1000;
const recent = new Map<string, { at: number; hash: string }>();

export interface AttestResult {
  attested: boolean;
  txHash?: string;
  attestationId?: string;
  reason?: string;
}

export async function attestReport(
  targetChainId: number,
  target: string,
  riskScore: number,
  reportHash: `0x${string}`,
  registryChainId: StakingChainId = DEFAULT_STAKING_CHAIN,
): Promise<AttestResult> {
  const key = process.env.ATTESTER_PRIVATE_KEY ?? process.env.BADGE_MINTER_PRIVATE_KEY;
  if (!key) return { attested: false, reason: "No attester key configured" };

  const network = networkFor(registryChainId);
  const registry = network.deployment.trustRegistry;
  if (!isDeployed(registry)) {
    return { attested: false, reason: `TrustRegistry not deployed on ${network.label}` };
  }

  // Re-attesting an identical hash costs gas and records nothing new.
  const dedupeKey = `${targetChainId}:${target.toLowerCase()}`;
  const seen = recent.get(dedupeKey);
  if (seen && seen.hash === reportHash && Date.now() - seen.at < DEDUPE_MS) {
    return { attested: false, reason: "Identical report already attested recently" };
  }

  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    const rpc = network.chain.rpcUrls.default.http[0];
    const publicClient = createPublicClient({ chain: network.chain, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain: network.chain, transport: http(rpc) });

    // Monad charges on gas_limit, so estimate rather than pass a fat constant.
    const gas = await publicClient.estimateContractGas({
      address: registry,
      abi: trustRegistryAbi,
      functionName: "attest",
      args: [BigInt(targetChainId), getAddress(target) as Address, riskScore, reportHash],
      account,
    });

    const txHash = await walletClient.writeContract({
      address: registry,
      abi: trustRegistryAbi,
      functionName: "attest",
      args: [BigInt(targetChainId), getAddress(target) as Address, riskScore, reportHash],
      gas: (gas * 120n) / 100n,
    });

    recent.set(dedupeKey, { at: Date.now(), hash: reportHash });
    return { attested: true, txHash };
  } catch (err) {
    // Out of gas, RPC down, nonce clash — none of which should surface as a
    // failed risk report.
    console.warn("[attest] failed:", (err as Error).message);
    return { attested: false, reason: (err as Error).message.split("\n")[0].slice(0, 140) };
  }
}

/// Reads the latest on-chain attestation for a target, so the report card can show
/// whether what you are reading is the same thing that was committed.
export async function readLatestAttestation(
  targetChainId: number,
  target: string,
  registryChainId: StakingChainId = DEFAULT_STAKING_CHAIN,
): Promise<{ riskScore: number; reportHash: string; attester: string; timestamp: number } | null> {
  const network = networkFor(registryChainId);
  const registry = network.deployment.trustRegistry;
  if (!isDeployed(registry)) return null;

  try {
    const client = createPublicClient({
      chain: network.chain,
      transport: http(network.chain.rpcUrls.default.http[0]),
    });
    const a = await client.readContract({
      address: registry,
      abi: trustRegistryAbi,
      functionName: "getLatest",
      args: [BigInt(targetChainId), getAddress(target) as Address],
    });
    return {
      riskScore: Number(a.riskScore),
      reportHash: a.reportHash,
      attester: a.attester,
      timestamp: Number(a.timestamp),
    };
  } catch {
    // Reverts with NoAttestation when nothing has been recorded yet.
    return null;
  }
}

import { createPublicClient, http, isAddress, getAddress, parseAbi, type Address } from "viem";
import { chainById } from "./chains";
import type { RawEvidence } from "./types";
import { fetchMarketData } from "./marketData";
import { fetchSocial } from "./social";

/// Gathers the on-chain and explorer facts a Trust Report is built from.
///
/// Hard rule for this whole module: it returns only what it actually observed.
/// Anything it could not fetch goes into `gaps` and stays null — a report must
/// never present an assumption as an observation, because the user is about to
/// decide whether to sign a transaction based on it.

const DEAD_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

const probeAbi = parseAbi([
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

/// Function selectors we look for in the deployed bytecode. Selector presence is
/// weaker evidence than verified source (a proxy hides its implementation), so the
/// caller degrades these to null for proxies rather than reporting a false negative.
const SELECTORS: Record<string, string[]> = {
  mint: ["40c10f19", "a0712d68"], // mint(address,uint256), mint(uint256)
  pause: ["8456cb59", "16c38b3c"], // pause(), setPaused(bool)
  blacklist: ["f9f92be4", "0ecb93c0", "e4997dc5"], // blacklist variants
};

export async function gatherEvidence(chainId: number, rawAddress: string): Promise<RawEvidence> {
  const gaps: string[] = [];
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  if (!isAddress(rawAddress)) throw new Error("Not a valid EVM address");

  const address = getAddress(rawAddress) as Address;

  // Try each RPC in turn. We must be able to tell "the chain says there is no code
  // here" apart from "we could not reach the chain" — conflating them once made
  // this report call USDC an ordinary wallet, which is the exact false negative
  // that gets someone rugged. If every endpoint fails we refuse to produce a
  // report at all rather than emit a confident wrong one.
  let client: ReturnType<typeof createPublicClient> | null = null;
  let bytecode: string | undefined;
  const rpcErrors: string[] = [];

  for (const url of chain.rpcUrls) {
    const candidate = createPublicClient({ transport: http(url) });
    try {
      bytecode = await candidate.getCode({ address });
      client = candidate;
      break;
    } catch (e) {
      rpcErrors.push(`${url}: ${firstLine((e as Error).message)}`);
    }
  }

  if (!client) {
    throw new Error(
      `Could not reach any ${chain.label} RPC, so nothing about this address could be verified. ` +
        `Tried ${chain.rpcUrls.length} endpoint(s). ${rpcErrors.join(" | ")}`,
    );
  }
  if (rpcErrors.length > 0) {
    gaps.push(`Some RPC endpoints were unreachable: ${rpcErrors.join(" | ")}`);
  }

  // Now this is a real observation: the chain answered, and the answer was "no code".
  const isContract = !!bytecode && bytecode !== "0x";
  if (!isContract) {
    return {
      isVerified: null,
      isContract: false,
      gaps: [...gaps, "Address has no deployed bytecode — it is an externally owned account, not a contract."],
    };
  }

  // Proxy check must come before any selector check. A proxy's own bytecode contains
  // none of the implementation's functions, so scanning it would report "no mint
  // function" for a token that absolutely has one — a false negative that reads as
  // reassurance. When we detect a proxy we follow it to the implementation, and if
  // we cannot, the selector checks report `null` (unknown), never `false`.
  const implementation = await resolveImplementation(client, address);
  let scanTarget = bytecode!;
  let proxyUnresolved = false;

  if (implementation) {
    gaps.push(`Target is a proxy; behaviour checks were run against its implementation ${implementation}.`);
    const implCode = await client.getCode({ address: implementation }).catch(() => undefined);
    if (implCode && implCode !== "0x") {
      scanTarget = implCode;
    } else {
      proxyUnresolved = true;
      gaps.push("Could not read the implementation's bytecode — mint/pause/blacklist checks are inconclusive.");
    }
  }

  const hex = scanTarget.toLowerCase();
  // `null` means "we could not determine this", which the scorer treats very
  // differently from a confident `false`.
  const hasSelector = (names: string[]): boolean | null =>
    proxyUnresolved ? null : names.some((s) => hex.includes(s));

  const [owner, totalSupply, decimals, symbol] = await Promise.all([
    client.readContract({ address, abi: probeAbi, functionName: "owner" }).catch(() => null),
    client.readContract({ address, abi: probeAbi, functionName: "totalSupply" }).catch(() => null),
    client.readContract({ address, abi: probeAbi, functionName: "decimals" }).catch(() => null),
    client.readContract({ address, abi: probeAbi, functionName: "symbol" }).catch(() => null),
  ]);

  if (owner === null) gaps.push("No `owner()` function — ownership model could not be determined from on-chain reads.");
  if (totalSupply === null) gaps.push("No `totalSupply()` — target may not be an ERC-20.");

  const [source, market, social] = await Promise.all([
    chain.explorerApi ? fetchSource(chain.explorerApi, chainId, address) : Promise.resolve(null),
    fetchMarketData(chainId, address),
    fetchSocial(chainId, address),
  ]);
  if (!chain.explorerApi) {
    gaps.push(`No explorer API configured for ${chain.label}; verification status and source-level checks unavailable.`);
  } else if (!source) {
    gaps.push("Explorer lookup failed or returned no data; verification status unknown.");
  }

  return {
    isContract: true,
    isVerified: source ? source.isVerified : null,
    contractName: source?.contractName,
    owner: owner ? (owner as string) : null,
    ownershipRenounced: owner ? DEAD_ADDRESSES.has((owner as string).toLowerCase()) : undefined,
    hasMintFunction: hasSelector(SELECTORS.mint),
    hasPauseFunction: hasSelector(SELECTORS.pause),
    hasBlacklistFunction: hasSelector(SELECTORS.blacklist),
    totalSupply: totalSupply !== null ? (totalSupply as bigint).toString() : undefined,
    decimals: decimals !== null ? Number(decimals) : undefined,
    symbol: symbol !== null ? (symbol as string) : undefined,
    // Holder distribution still needs an indexer or a paid explorer tier.
    topHolders: undefined,
    // Pools now come from a real source rather than being guessed.
    liquidityPools: market.pools.map((p) => ({ address: p.address, label: p.name })),
    market: {
      listed: market.listed,
      unavailableReason: market.unavailableReason,
      priceUsd: market.priceUsd,
      fdvUsd: market.fdvUsd,
      volume24hUsd: market.volume24hUsd,
      totalLiquidityUsd: market.totalLiquidityUsd,
      topPoolShare: market.topPoolShare,
      pools: market.pools.map((p) => ({
        address: p.address,
        name: p.name,
        reserveUsd: p.reserveUsd,
        createdAt: p.createdAt,
      })),
    },
    social: {
      checked: social.checked,
      unavailableReason: social.unavailableReason,
      website: social.website,
      twitter: social.twitter,
      telegram: social.telegram,
      discord: social.discord,
      gtScore: social.gtScore,
      telegramUsers: social.telegramUsers,
      watchlistUsers: social.watchlistUsers,
      sentimentUpPct: social.sentimentUpPct,
      hasAnyPresence: social.hasAnyPresence,
    },
    deployer: source?.deployer ?? null,
    gaps: [
      ...gaps,
      "Holder concentration not available: requires an indexer or paid explorer tier.",
      ...(market.unavailableReason ? [market.unavailableReason] : []),
    ],
  };
}

/// EIP-1967 / EIP-1822 implementation slots, plus the legacy OpenZeppelin slot.
/// Reading storage directly works for any proxy following these standards without
/// needing the proxy to expose an `implementation()` getter.
const PROXY_SLOTS = [
  // bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  // keccak256("PROXIABLE") — EIP-1822 UUPS
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7",
  // legacy OpenZeppelin: bytes32(keccak256("org.zeppelinos.proxy.implementation"))
  "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
] as const;

async function resolveImplementation(
  client: ReturnType<typeof createPublicClient>,
  address: Address,
): Promise<Address | null> {
  for (const slot of PROXY_SLOTS) {
    try {
      const raw = await client.getStorageAt({ address, slot: slot as `0x${string}` });
      if (!raw || raw === "0x" || /^0x0+$/.test(raw)) continue;
      // Storage slots are 32 bytes; an address occupies the low 20.
      const candidate = getAddress(`0x${raw.slice(-40)}`) as Address;
      if (!/^0x0+$/.test(candidate)) return candidate;
    } catch {
      // Slot unreadable — try the next standard.
    }
  }
  return null;
}

/// RPC errors embed whole HTML error pages. Keep the useful first line so a gap
/// message stays readable in the UI.
function firstLine(msg: string): string {
  return msg.split("\n")[0].slice(0, 160);
}

interface SourceInfo {
  isVerified: boolean;
  contractName?: string;
  deployer?: string | null;
}

/// Etherscan V2: one host, chain selected by `chainid`. A missing key is a normal
/// state (the app must work without one), not an error worth throwing over.
async function fetchSource(apiBase: string, chainId: number, address: string): Promise<SourceInfo | null> {
  const key = process.env.ETHERSCAN_API_KEY;
  if (!key) return null;

  try {
    const url = `${apiBase}?chainid=${chainId}&module=contract&action=getsourcecode&address=${address}&apikey=${key}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json?.result?.[0];
    if (!entry) return null;

    return {
      // Etherscan returns an empty SourceCode string for unverified contracts.
      isVerified: typeof entry.SourceCode === "string" && entry.SourceCode.length > 0,
      contractName: entry.ContractName || undefined,
      deployer: entry.ContractCreator || null,
    };
  } catch {
    return null;
  }
}

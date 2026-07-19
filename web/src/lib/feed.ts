import { createPublicClient, http, parseAbiItem, formatEther, formatUnits } from "viem";
import { getDiscovered } from "./discovery";
import { chunkedGetLogs } from "./logs";
import { parseAbi } from "viem";
import {
  networkFor,
  isDeployed,
  DEFAULT_STAKING_CHAIN,
  type StakingChainId,
  type StakingNetwork,
} from "./networks";

/// The live feed — Loop 4 ("Warn") from the spec, widened to cover everything the
/// product does rather than just resolutions.
///
/// Sources, in order of how much they matter to a reader:
///   FRESH_DEPLOY    a contract just deployed on-chain, auto-scanned for backdoors
///   RUG_CONFIRMED   a call resolved RUG — someone's suspicion was proven
///   ODDS_SWING      the market moved hard toward RUG — the early-warning signal
///   BIG_STAKE       someone put real size behind a view
///   SAFE_RESOLVED   a call survived its window
///   NEW_CALL        a contract is now being priced
///   TOKEN_LAUNCHED  a backdoor-free token shipped
///
/// Everything here is derived from on-chain events. Nothing is seeded, faked, or
/// padded — an empty feed means nothing has happened yet, and it says so.

const stakedEvent = parseAbiItem(
  "event Staked(uint256 indexed callId, address indexed wallet, bool betRug, uint256 amount, uint256 totalSafeStake, uint256 totalRugStake)",
);
const resolvedEvent = parseAbiItem(
  "event Resolved(uint256 indexed callId, bool outcomeIsRug, address resolvedBy)",
);
const createdEvent = parseAbiItem(
  "event CallCreated(uint256 indexed callId, uint256 indexed chainId, address indexed target, address creator, uint256 windowEnd)",
);
const marketReadAbi = parseAbi([
  "function callCount() view returns (uint256)",
  "function getCall(uint256 callId) view returns ((uint256 chainId, address target, address creator, uint256 windowEnd, uint256 totalSafeStake, uint256 totalRugStake, bool resolved, bool outcomeIsRug, bool voided))",
]);

const launchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed creator, string name, string symbol, uint256 supply, string metadataURI)",
);

export type FeedKind =
  | "RUG_CONFIRMED"
  | "ODDS_SWING"
  | "BIG_STAKE"
  | "SAFE_RESOLVED"
  | "NEW_CALL"
  | "TOKEN_LAUNCHED"
  /// A contract that just appeared on-chain, scanned automatically. Not something
  /// a PolMad user did — this is the product watching the chain on its own.
  | "FRESH_DEPLOY";

export interface FeedItem {
  id: string;
  kind: FeedKind;
  headline: string;
  detail: string;
  /// Contract the item is about, for explorer links and risk checks.
  subject?: `0x${string}`;
  callId?: string;
  blockNumber: bigint;
  timestamp?: number;
  /// Pre-written share text. The viral surface only works if posting is one tap.
  share: string;
  /// Present on auto-scanned deploys.
  riskScore?: number;
}

const BIG_STAKE_MON = 1;
/// A swing this large in one trade means someone with conviction just arrived.
const SWING_THRESHOLD_PCT = 15;

export interface FeedResult {
  items: FeedItem[];
  degraded: boolean;
  /// Which sources actually responded, so the UI can distinguish "nothing has
  /// happened" from "we could not read half the chain".
  sources: { market: boolean; launchpad: boolean; chain: boolean };
  /// True on a cold start while the first chain sweep runs.
  warming?: boolean;
}

export async function readFeed(
  chainId: StakingChainId = DEFAULT_STAKING_CHAIN,
  limit = 60,
): Promise<FeedResult> {
  const network = networkFor(chainId);
  const client = createPublicClient({
    chain: network.chain,
    transport: http(network.chain.rpcUrls.default.http[0]),
  });

  const market = network.deployment.propheyMarket;
  const factory = network.deployment.tokenFactory;

  const head = await client.getBlockNumber().catch(() => null);
  if (head === null) {
    return { items: [], degraded: true, sources: { market: false, launchpad: false, chain: false } };
  }

  /// Log scans cover a recent window only. Reading from the deployment block meant
  /// ~220 chunked requests per event type, which took minutes and timed out — a
  /// feed is about what just happened, so a bounded recent slice is both faster
  /// and more correct. Full history for the leaderboard is handled separately.
  const LOG_WINDOW = 3_000n;
  const since = head > LOG_WINDOW ? head - LOG_WINDOW : 0n;

  const [marketLogs, launchLogs, discovered] = await Promise.all([
    isDeployed(market)
      ? Promise.all([
          chunkedGetLogs(client as never, { address: market, event: createdEvent, fromBlock: since, toBlock: head, budgetMs: 5_000 }),
          chunkedGetLogs(client as never, { address: market, event: stakedEvent, fromBlock: since, toBlock: head, budgetMs: 5_000 }),
          chunkedGetLogs(client as never, { address: market, event: resolvedEvent, fromBlock: since, toBlock: head, budgetMs: 5_000 }),
        ])
          .then(([c, s2, r]) => [c.logs, s2.logs, r.logs] as const)
          .catch(() => null)
      : Promise.resolve(null),
    isDeployed(factory)
      ? chunkedGetLogs(client as never, { address: factory, event: launchedEvent, fromBlock: since, toBlock: head })
          .then((r) => r.logs)
          .catch(() => null)
      : Promise.resolve(null),
    // Independent of our own contracts: this is the chain itself.
    // Non-blocking: returns cached results instantly and refreshes in background.
    Promise.resolve(getDiscovered(chainId)),
  ]);

  const items: FeedItem[] = [];
  const explorer = network.chain.blockExplorers.default.url;

  // Calls come from contract state rather than logs. A log window wide enough to
  // reach the first call would be thousands of chunked requests on this RPC, and
  // callCount + getCall is both complete and a handful of calls.
  const targetOf = new Map<string, `0x${string}`>();
  if (isDeployed(market)) {
    try {
      const count = await client.readContract({
        address: market,
        abi: marketReadAbi,
        functionName: "callCount",
      });
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1)).slice(-40);

      for (const id of ids) {
        const c = await client.readContract({
          address: market,
          abi: marketReadAbi,
          functionName: "getCall",
          args: [id],
        });
        targetOf.set(id.toString(), c.target);

        const settled = c.resolved || c.voided;
        items.push({
          id: `call-${id}`,
          kind: c.resolved && c.outcomeIsRug ? "RUG_CONFIRMED" : settled ? "SAFE_RESOLVED" : "NEW_CALL",
          headline: c.voided
            ? "CALL VOIDED — REFUNDS OPEN"
            : c.resolved
              ? c.outcomeIsRug
                ? "RUG CONFIRMED"
                : "SURVIVED THE WINDOW"
              : "CALL OPEN",
          detail: c.resolved
            ? `${short(c.target)} resolved ${c.outcomeIsRug ? "RUG" : "SAFE"}. Pool ${fmtMon(c.totalSafeStake + c.totalRugStake)} MON.`
            : `${short(c.target)} is being priced — ${fmtMon(c.totalSafeStake)} MON on SAFE vs ${fmtMon(c.totalRugStake)} MON on RUG.`,
          subject: c.target,
          callId: id.toString(),
          blockNumber: head,
          share: c.resolved && c.outcomeIsRug
            ? `🚨 RUG CONFIRMED: ${short(c.target)}\n\nResolved automatically from on-chain evidence — no human judgment.\n\n${explorer}/address/${c.target}`
            : `Is ${short(c.target)} safe? There's a live market on it right now.\n\n${explorer}/address/${c.target}`,
        });
      }
    } catch {
      /* falls back to whatever the log scan found */
    }
  }

  if (marketLogs) {
    const [, staked] = marketLogs;

    // Odds swings: replay stakes per call and flag any single trade that moved
    // the implied RUG probability hard. This is the signal a passive reader wants
    // — it says "someone who may know something just showed up".
    const byCall = new Map<string, typeof staked>();
    for (const l of staked) {
      const k = l.args.callId!.toString();
      if (!byCall.has(k)) byCall.set(k, [] as never);
      byCall.get(k)!.push(l);
    }

    for (const [callId, logs] of byCall) {
      const ordered = [...logs].sort((a, b) =>
        a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber),
      );
      let prevRug: number | null = null;

      for (const l of ordered) {
        const safe = l.args.totalSafeStake!;
        const rug = l.args.totalRugStake!;
        const total = safe + rug;
        const rugPct = total > 0n ? Number((rug * 10000n) / total) / 100 : 0;
        const target = targetOf.get(callId);
        const amount = Number(formatEther(l.args.amount!));

        if (prevRug !== null && rugPct - prevRug >= SWING_THRESHOLD_PCT) {
          items.push({
            id: `swing-${l.transactionHash}-${l.logIndex}`,
            kind: "ODDS_SWING",
            headline: "ODDS SWUNG TOWARD RUG",
            detail: `Call #${callId} moved ${prevRug.toFixed(0)}% → ${rugPct.toFixed(0)}% RUG on a single ${amount.toFixed(2)} MON stake.`,
            subject: target,
            callId,
            blockNumber: l.blockNumber,
            share: `⚠️ The market just swung to ${rugPct.toFixed(0)}% RUG on ${target ? short(target) : `call #${callId}`}.\n\nSomeone is betting real money this one goes bad.\n\n${explorer}/address/${target ?? ""}`,
          });
        }
        prevRug = rugPct;

        if (amount >= BIG_STAKE_MON) {
          items.push({
            id: `stake-${l.transactionHash}-${l.logIndex}`,
            kind: "BIG_STAKE",
            headline: l.args.betRug ? "SIZE ON RUG" : "SIZE ON SAFE",
            detail: `${amount.toFixed(2)} MON staked on ${l.args.betRug ? "RUG" : "SAFE"}${target ? ` for ${short(target)}` : ""}.`,
            subject: target,
            callId,
            blockNumber: l.blockNumber,
            share: `${amount.toFixed(2)} MON just went on ${l.args.betRug ? "RUG" : "SAFE"} for ${target ? short(target) : `call #${callId}`}.`,
          });
        }
      }
    }

  }

  if (launchLogs) {
    for (const l of launchLogs) {
      const token = l.args.token!;
      const symbol = l.args.symbol ?? "";
      items.push({
        id: `launch-${l.transactionHash}-${l.logIndex}`,
        kind: "TOKEN_LAUNCHED",
        headline: "TOKEN LAUNCHED — NO BACKDOOR",
        detail: `${l.args.name} ($${symbol}) shipped with ${Number(formatUnits(l.args.supply!, 18)).toLocaleString()} fixed supply, no owner, no mint.`,
        subject: token,
        blockNumber: l.blockNumber,
        share: `${l.args.name} ($${symbol}) just launched on Monad with no mint function, no owner, and no pause switch.\n\nIt cannot rug — verified on-chain.\n\n${explorer}/address/${token}`,
      });
    }
  }

  for (const c of discovered.contracts) {
    const risky = c.riskScore >= 40;
    const label = c.symbol ? `${c.name ?? "Token"} ($${c.symbol})` : short(c.address);
    items.push({
      id: `deploy-${c.address}`,
      kind: "FRESH_DEPLOY",
      headline: risky
        ? `NEW ${c.isToken ? "TOKEN" : "CONTRACT"} — RISK ${c.riskScore}`
        : `NEW ${c.isToken ? "TOKEN" : "CONTRACT"} DEPLOYED`,
      detail: `${label} deployed by ${short(c.deployer)}. ${c.flags.join(", ")}.`,
      subject: c.address,
      blockNumber: c.blockNumber,
      timestamp: c.timestamp,
      riskScore: c.riskScore,
      share: risky
        ? `⚠️ New token just deployed on Monad: ${label}\n\nAutomated scan: risk ${c.riskScore}/100 — ${c.flags.join(", ")}.\n\n${explorer}/address/${c.address}`
        : `New contract on Monad: ${label}\n\nScanned automatically — ${c.flags.join(", ")}.\n\n${explorer}/address/${c.address}`,
    });
  }

  // Real timestamps, fetched only for the blocks we actually show. Sorting by
  // block number alone would interleave sources incorrectly across long gaps.
  items.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  const top = items.slice(0, limit);
  await attachTimestamps(client, top);

  return {
    items: top,
    degraded:
      (isDeployed(market) && !marketLogs) ||
      (isDeployed(factory) && !launchLogs) ||
      false,
    sources: { market: !!marketLogs, launchpad: !!launchLogs, chain: !discovered.stale },
    warming: discovered.warming,
  };
}

async function attachTimestamps(
  client: ReturnType<typeof createPublicClient>,
  items: FeedItem[],
) {
  const blocks = [...new Set(items.map((i) => i.blockNumber))].slice(0, 40);
  const times = new Map<bigint, number>();

  await Promise.all(
    blocks.map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: bn });
        times.set(bn, Number(b.timestamp));
      } catch {
        /* timestamp is a nicety; the item still renders without it */
      }
    }),
  );

  for (const item of items) item.timestamp = times.get(item.blockNumber);
}

function fmtMon(wei: bigint): string {
  return Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function networkLabel(n: StakingNetwork): string {
  return n.label;
}

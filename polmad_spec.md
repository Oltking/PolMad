# Polymad — Product & Technical Spec (v1)

*Working title, rename freely. Built for the "Spark" BuildAnything hackathon on Monad.*

> **For the coding agent:** this is a build spec, not marketing copy. Sections 6–12 are what you actually implement. Sections 1–5 are context so you understand *why* each piece exists — don't skip them, they explain tradeoffs you'll need to make while coding.

---

## 1. Problem

Anyone who has used crypto for more than a week has been burned, or nearly burned, by a contract that turned out to be malicious — an owner who could mint unlimited supply, a liquidity pool that got drained in one transaction, a token with 90% of supply sitting in two wallets. The information to catch this usually *exists* publicly (block explorer, LP data, holder lists) but it's scattered across four or five tools, and almost nobody checks all of them before signing a transaction. There is no fast, trustworthy, single place to ask "is this safe?" and get an honest answer — and the honest answer is rarely obvious from a webpage alone, because a project *can* pay people to say it's safe.

## 2. Solution

**Polymad** is a risk-check tool that works on any EVM contract, on any chain, for free — and a prediction market, settled on Monad, where people put real stake behind their read of a contract's safety. The AI report gives you a first opinion. The live market — real money, staked by real people, resolved by objective onchain conditions — gives you a second opinion that's much harder to fake, because faking it costs money and losing bets in public.

One-liner: *"Paste an address. See the score. Bet on the outcome. Get paid if you're right."*

## 3. Why this hits all three requirements

### 3.1 Fun
- Live odds on every contract, like a sportsbook — number moves as people stake, which is inherently watchable.
- Real payout when you call it correctly, not just internet points.
- Streaks, levels, and collectible onchain badges for accuracy over time (see §7.3).
- A public leaderboard and a "Wall of Shame" feed of busted rugs — content people screenshot and post unprompted.

### 3.2 Real problem, not decorative crypto
- The AI report answers the question people actually have ("should I touch this contract?") using data that already exists but nobody assembles: ownership/mint controls, liquidity lock status, holder concentration, verification status, deployer wallet history.
- The market layer isn't just gambling wrapped in a demo — a prediction market is a legitimate way to aggregate distributed information (this is the same principle behind Polymarket-style forecasting): someone who has private knowledge that a deployer is quietly moving liquidity has a financial reason to bet RUG *before* it happens, and that bet itself becomes a visible early-warning signal for everyone else watching the odds, even if they never stake a cent.
- The onchain component is load-bearing, not decorative: real MON is escrowed and moves based on a contract's resolution logic. Nothing about it could be faked with a static webpage.

### 3.3 Daily use, including people outside the Monad ecosystem
This is the piece that needed fixing, so be deliberate about it while building:
- **The Check loop is 100% chain-agnostic and free.** Someone with an Ethereum or Base wallet who has never touched Monad can paste a contract and get a report with zero friction, zero wallet connect required.
- **The Call and Prove loops require a Monad wallet.** To actually stake, claim a payout, or mint a badge, the user needs MON and a Monad-connected wallet. This is the conversion funnel: free chain-agnostic utility pulls people in, the fun/incentive layer is what gets them to actually transact on Monad.
- **There is always something new to check.** New contracts deploy constantly across every chain being watched, so the habit loop resembles checking sports scores or stock movement — there's fresh content every time you open it, not a static tool you use once and forget.

---

## 4. Personas (keep these in mind while making UX calls)

- **The Degen Checker** — any wallet, any chain. Wants a fast, free safety read before signing a transaction. May never stake. This is the top of the funnel.
- **The Prophecy Player** — has a Monad wallet, plays the market for fun and profit, cares about streaks/leaderboard/badges. This is the daily-retention persona.
- **The Silent Beneficiary** — never stakes, just glances at the live feed / Wall of Shame before making decisions elsewhere. Benefits from the crowd's work without contributing to it. Fine — this is what makes the feed a viral, shareable surface.

---

## 5. Core User Loops

**Loop 1 — Check** (free, chain-agnostic, no wallet required)
Paste a contract address + select chain → get a Trust Report: 0–100 risk score, sub-scores (ownership, liquidity, holder concentration, verification, mint/burn control), and a plain-language AI summary → see live Prophecy Odds if a Call exists for this contract.

**Loop 2 — Call** (Monad-native, requires wallet + MON)
From a Trust Report, tap "Create Call" (if none exists) or "Stake" on an existing one → choose SAFE or RUG → choose stake amount → confirm transaction → position shows in "My Calls."

**Loop 3 — Prove** (reputation, retention)
When a Call resolves, correct stakers can claim their share of the pool. Caller Score updates — a correct call against a crowd that mostly guessed wrong is worth more than a correct call everyone made (weighting logic in §7.2). Milestones mint a free Verifier Badge NFT.

**Loop 4 — Warn** (viral, passive value)
Any contract whose live odds swing sharply toward RUG, or that resolves as an actual rug, gets pushed to a public live feed with a one-tap "share to X" card.

---

## 6. Resolution Logic — how a Call resolves without a human judge

This is the trickiest design problem, so be explicit about the tradeoff: for a hackathon build, resolution must be **deterministic and checkable from onchain data**, not subjective. Define RUG as any of the following occurring on the target contract within the Call window (default 72h):

1. Liquidity pool balance drops more than 50% in a single transaction (classic liquidity-pull signature).
2. The owner/admin address calls a mint function that increases supply by more than a configurable threshold (e.g. 20%).
3. The owner/admin address calls a pause/blacklist function that blocks transfers or selling.

If none of these trigger before the window closes, the Call resolves SAFE.

**How it gets resolved on Monad:** a small off-chain "keeper" script watches the target contract's events (on whichever chain it lives on — this may not be Monad, since Check works cross-chain) and calls `resolve(callId, outcome)` on the Monad-deployed `PropheyMarket` contract when a trigger fires, or automatically resolves SAFE at window expiry.

**Honest limitation to flag to the user in the UI and in the README:** for this build, the keeper is a single trusted off-chain service (documented in §13 as a known centralization tradeoff, not hidden). A production version would need a decentralized keeper set or an oracle network voting on resolution — call this out explicitly as a "Phase 3 / roadmap" item, don't pretend it's already solved.

**Demo-safety fallback:** for the live demo, deploy a mock ERC-20 with an obvious owner-controlled mint function on Monad testnet. Stake on it live, then call `mint()` from the owner wallet on stage to trigger real-time resolution and a real payout in front of judges. This avoids depending on a real rug happening during a 3-minute demo window.

---

## 7. Smart Contracts (Monad testnet, Solidity)

Deploy all three below. Keep them simple and heavily commented — judges' AI agent will read the code.

### 7.1 `TrustRegistry.sol` — attestation store (EAS-inspired)

Generalized, schema-based store so other Monad apps could theoretically read from it later.

```solidity
struct Attestation {
    uint256 chainId;       // chain the target contract lives on
    address target;        // contract being attested about
    uint8   riskScore;     // 0-100
    bytes32 reportHash;    // hash of the full AI report JSON (stored off-chain)
    address attester;      // who/what made this attestation (backend signer or user wallet)
    uint256 timestamp;
}

function attest(uint256 chainId, address target, uint8 riskScore, bytes32 reportHash) external returns (uint256 attestationId);
function getLatest(uint256 chainId, address target) external view returns (Attestation memory);
function getHistory(uint256 chainId, address target) external view returns (Attestation[] memory);
```

### 7.2 `PropheyMarket.sol` — the prediction market

```solidity
struct Call {
    uint256 chainId;
    address target;
    uint256 windowEnd;
    uint256 totalSafeStake;
    uint256 totalRugStake;
    bool    resolved;
    bool    outcomeIsRug;   // only valid if resolved == true
}

function createCall(uint256 chainId, address target, uint256 windowSeconds) external returns (uint256 callId);
function stake(uint256 callId, bool betRug) external payable;
function resolve(uint256 callId, bool rugOccurred) external; // onlyResolver role
function claim(uint256 callId) external; // pays out proportional share of losing pool to winners
```

**Caller Score weighting (for the leaderboard, computed off-chain from onchain events, not in the contract itself):** weight a correct call inversely to how many people agreed with it at stake time — e.g. `score += stake_amount * (1 / fraction_of_pool_on_winning_side)`. This rewards contrarian-but-correct calls more than piling onto consensus, which is the same principle Community Notes uses to make ratings from people who usually disagree count more than raw agreement — it's what makes the signal resistant to a project just rallying its own community to bet SAFE on itself.

### 7.3 `VerifierBadge.sol` — ERC-721 badges, POAP-style

```solidity
function mintBadge(address to, uint256 badgeType) external; // onlyMinter (backend), called when a milestone is confirmed off-chain
function badgesOf(address wallet) external view returns (uint256[] memory);
```

Badge types for v1: `FIRST_CORRECT_CALL`, `FIVE_CALL_STREAK`, `AGAINST_THE_CROWD` (won a call where you were in the minority stake), `TOP_10_WEEKLY`.

---

## 8. Backend Services

**AI Report Service** (`/api/report`)
Input: chain + contract address.
Pulls: bytecode/ABI if verified, owner/admin address + tx history, LP token balance and lock status (via DEX subgraph or explorer API for that chain), top-holder distribution.
Feeds the assembled data into the Claude API (Anthropic) with a prompt requesting structured JSON output: sub-scores per category, an overall 0–100 score, and a short plain-language narrative. Use Claude Sonnet 5 (model string `claude-sonnet-5`) — confirm exact request syntax against current docs at https://docs.claude.com before implementing, since API details can change.
Output cached in the `contracts` table; hash of the JSON gets written to `TrustRegistry` via `attest()`.

**Keeper / Resolver Service** (`keeper.ts`, run as a small persistent process or scheduled job)
Polls active Calls from `PropheyMarket`, watches each target contract's events on its native chain for the trigger conditions in §6, calls `resolve()` when triggered or at window expiry.

**Indexer**
Simple polling/caching layer so the frontend isn't hitting RPC directly on every page load. A lightweight cron that reads contract events and writes to the DB tables in §9 is sufficient for hackathon scope — no need for a full subgraph.

---

## 9. Data Model

| Table | Key fields |
|---|---|
| `contracts` | chain_id, address, latest_score, report_json, last_checked_at |
| `calls` | call_id, chain_id, target_address, window_end, total_safe_stake, total_rug_stake, resolved, outcome |
| `stakes` | call_id, wallet, side, amount, claimed |
| `callers` | wallet, correct_calls, total_calls, streak, caller_score |
| `feed_events` | type (new_call / odds_swing / resolved_rug / resolved_safe), contract, detail, timestamp |

---

## 10. Frontend Pages

- **`/` Check** — address + chain input, Trust Report card, live odds if a Call exists, "Create Call" / "Stake" CTA.
- **`/calls`** — list of active Calls, filter by chain, stake modal.
- **`/calls/[id]`** — Call detail, live odds chart, your position, claim button once resolved.
- **`/leaderboard`** — top Caller Scores, streaks, filters (weekly/all-time).
- **`/feed`** — live public feed, shareable cards.
- **`/profile/[wallet]`** — badges held, call history, accuracy.

---

## 11. Tech Stack Recommendation

- **Contracts:** Solidity, Foundry (or Hardhat — see Monad's official guides below for either).
- **Frontend:** Next.js (App Router), wagmi + viem for wallet/contract interaction, RainbowKit or ConnectKit for wallet connect.
- **Backend:** Next.js API routes for `/api/report` and `/api/attest`; a standalone Node script for the keeper (needs to run continuously or on a schedule — Vercel Cron works for polling every few minutes).
- **DB:** anything lightweight — SQLite/Postgres via an ORM (Prisma is fine) is sufficient for hackathon scope.
- **AI:** Anthropic Claude API for report synthesis (see §8).
### Monad Testnet — confirmed network details

| Field | Value |
|---|---|
| Chain ID | `10143` |
| Network name | Monad Testnet |
| Currency | MON |
| RPC URL | `https://testnet-rpc.monad.xyz` (50 rps; alternates: `https://rpc.ankr.com/monad_testnet`, `https://rpc-testnet.monadinfra.com`) |
| Block explorer | `https://testnet.monadvision.com` or `https://testnet.monadscan.com` |
| Faucet | `https://faucet.monad.xyz` — enter wallet address; connecting X/Discord unlocks more per claim |

### Contract deploy/verify — Monad Foundry (confirmed commands)

```bash
# install Monad's Foundry fork
curl -L https://foundry.category.xyz | bash
foundryup --network monad

# new project, pre-configured for Monad testnet
forge init --template monad-developers/foundry-monad polymad-contracts
```

`foundry.toml` should already be set to:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
eth-rpc-url = "https://testnet-rpc.monad.xyz"
chain_id = 10143
```

Deploy with a keystore (recommended over raw private keys):
```bash
cast wallet import polymad-deployer --private-key $(cast wallet new | grep 'Private key:' | awk '{print $3}')
forge create src/TrustRegistry.sol:TrustRegistry --account polymad-deployer --broadcast
```

Verify (Monadscan):
```bash
forge verify-contract <contract_address> <ContractName> \
    --chain 10143 \
    --verifier etherscan \
    --etherscan-api-key YourApiKeyToken \
    --watch
```

### Agent tooling — use these instead of hand-rolling Monad specifics

**Monskills** — gives coding agents (Claude Code included) curated, Monad-specific knowledge on scaffolding, wallet integration, gas, addresses, and indexers, so the agent isn't guessing at chain-specific details. Install:
```bash
npx skills add therealharpaljadeja/monskills
```
or, inside Claude Code:
```
/plugin marketplace add therealharpaljadeja/monskills
/plugin install monskills@monskills
```
Once installed, tell the agent: *"Use the locally installed MONSKILLS. Start with the monskill routing skill, then fetch only the local topic skills needed: scaffold, wallet-integration, gas, addresses, tooling-and-infra, indexer."* Prompt-style reference (for phrasing, not literal use): https://skills.devnads.com/prompts

**Impeccable** — a frontend design skill built specifically to stop AI-generated UIs from looking AI-generated (generic gradients, glassmorphism, templated layout). Directly relevant here: the hackathon's judging agent explicitly penalizes "AI slop" UI. Install:
```bash
npx impeccable install
```
or as a Claude Code plugin. Run `/impeccable init` once at project start, and `/impeccable polish` on the UI once the app is functional, before recording the demo.

**Official references:**
- Deploy guide (all tools): https://docs.monad.xyz/guides/deploy-smart-contract/index
- Verify guide (all tools): https://docs.monad.xyz/guides/verify-smart-contract/index
- Full docs index: https://docs.monad.xyz/

---

## 12. Build Order

1. Install MONSKILLS first (see §11) and scaffold repo using its `scaffold` skill if available: `/contracts` (Foundry), `/apps/web` (Next.js), `/apps/keeper` (Node script).
2. Write + test `TrustRegistry.sol` and `PropheyMarket.sol` locally.
3. Deploy both to Monad testnet, verify (use Monskills if available, otherwise the guides above). Get testnet MON from the faucet.
4. Build `/api/report`: data pull + Claude API call → structured JSON → cache.
5. Build the Check page, wire to `/api/report` and `TrustRegistry.attest()`.
6. Build the Calls page + stake modal, wire to `PropheyMarket`.
7. Build the keeper script, test resolution end-to-end against a mock rug contract (see §6 demo fallback).
8. Build claim flow.
9. Add `VerifierBadge.sol`, mint on milestone, add badges to profile page.
10. Add leaderboard (Caller Score computed per §7.2) and live feed page.
11. Deploy a mock ERC-20 with an owner-mint backdoor on testnet, specifically for the live demo trigger.
12. Run Impeccable's `/impeccable polish` on the UI (keep it tight and single-purpose — avoid anything that reads as generic/templated), write README, record demo video.

---

## 13. Non-Goals for v1 (explicitly out of scope, don't build these)

- No founder/social-graph intelligence, no wallet PnL profiling, no news aggregation — none of the broader "ecosystem dashboard" features from earlier brainstorming. This build is narrowly the Check + Call + Prove + Warn loop.
- No decentralized keeper/oracle network — single trusted resolver service, documented as a known limitation, not hidden.
- No subjective/human-judged resolution — RUG is only ever triggered by the deterministic onchain conditions in §6.
- No multi-chain staking — staking always happens on Monad regardless of which chain the target contract lives on.

## 14. Known Limitations to State Plainly in the README

- Resolution keeper is centralized for this build.
- RUG detection covers three common patterns, not every possible exploit — false negatives are possible and should be acknowledged, not hidden.
- Cross-chain report data quality depends on each chain's explorer/subgraph availability; start with Monad + Ethereum, add others only once those two are solid.

## 15. Judging Criteria Alignment (for your own tracking, not user-facing copy)

- **Real problem:** rug/scam risk is something essentially every crypto user has been burned by.
- **Genuine onchain component:** real MON is escrowed, staked, and slashed based on contract logic — not a UI wrapper around a database.
- **Not AI slop:** this is a specific mechanic (attestation + resolvable prediction market), not a todo app or dashboard template; keep the UI tight and give it a distinct identity rather than a generic dashboard look.
- **Not vaporware:** the Call → resolve → claim flow must actually move funds live in the demo, not show a fake success toast.

## 16. Appendix — Kickoff Prompt for Claude Code

Paste this into Claude Code alongside this spec file to start the build. It's written to match the phrasing MONSKILLS' own prompt library expects, so the agent routes to the right local skill docs instead of guessing at Monad specifics.

```
Before building, open https://skills.devnads.com/install.md and follow its MONSKILLS
install instructions. After MONSKILLS is installed, use the local monskill routing
skill and build Polymad, a cross-chain contract risk-checker with a Monad-native
prediction market.

Fetch scaffold/ first. Build a Next.js app where any visitor — no wallet required —
can paste an EVM contract address and chain, and receive an AI-generated Trust
Report (0-100 risk score with sub-scores for ownership, liquidity, holder
concentration, verification status, and mint/burn control, plus a plain-language
summary). Then build the Monad-native layer: a connected wallet can create or stake
on a "Prophecy Call" — a bet on whether that contract will exhibit rug-like behavior
(large liquidity pull, supply-inflating mint, or a transfer-blocking pause/blacklist
call) within a fixed window. Calls resolve automatically from onchain conditions,
not human judgment, and winners claim a share of the losing side's stake.

Fetch wallet-integration/ for wallet connect on Monad testnet. Fetch addresses/
before referencing any Monad testnet canonical contract and verify code on the
network. Fetch gas/ because stake, resolve, and claim transactions need tight gas
limits and clear cost display. Fetch concepts/ for block states so the UI can show
pending, safe, finalized, and failed states on every transaction. Fetch indexer/ to
power the leaderboard, call history, and live feed. Fetch tooling-and-infra/ to pick
Monad-supported RPC, explorer, and indexing providers from official sources.

Deploy three contracts to Monad testnet: TrustRegistry (schema-based attestation
store: chainId, target address, riskScore, reportHash, attester, timestamp),
PropheyMarket (createCall, stake, resolve via a resolver role, claim), and
VerifierBadge (ERC-721 badges minted on milestones: first correct call, five-call
streak, correct call against majority consensus).

Full contract-level detail, resolution rules, data model, and page list are in the
attached polymad-spec.md — follow it as the source of truth for product logic; use
MONSKILLS for anything Monad-infrastructure-specific the spec doesn't cover.

Add safety rails: never fabricate a risk score without real onchain data backing it,
show exact contract addresses and gas costs before any transaction, and clearly
label the AI report as a risk signal, not financial advice.

Once the app is functional, install Impeccable (https://impeccable.style) and run
/impeccable polish on the UI before final submission — avoid anything that reads as
generic AI-generated interface.

Deliver: Check page, Calls page + stake modal, Leaderboard, live Feed, Profile page,
deployed and verified contracts on Monad testnet, a keeper script for resolution, a
README documenting known limitations (centralized resolver, cross-chain data
quality dependent on explorer/subgraph availability per chain), and a demo-mode
mock ERC-20 with an owner-mint backdoor for live demonstration of the resolution
flow.
```

## 17. Open Questions to Confirm Before/While Building

- Which two chains beyond Monad should Check support first for the demo (Ethereum + Base recommended, but confirm RPC/API key availability)?
- Default stake denomination and minimum stake amount for testnet MON?
- Default Call window length — 72h suggested, but should be configurable per Call?
- Badge art/metadata — placeholder SVGs are fine for v1, don't block on custom art.
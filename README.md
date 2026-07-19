# PolMad

**Paste an address. See the score. Bet on the outcome.**

A free contract risk checker for any EVM chain, plus a Monad-native prediction
market where people stake real MON on whether a contract will rug — resolved
automatically from on-chain conditions, not human judgment.

The report gives you a first opinion. The market gives you a second one that is
much harder to fake, because faking it costs money and losing bets in public.

**Live:** https://polmad.vercel.app
**Contracts:** all verified on Monad testnet (addresses below)

---

## Why this exists

I got rugged, and afterwards realised every warning sign had been public the whole
time — the owner could mint, the liquidity was one pullable pool, the contract was
never verified. That data is free and on-chain, but scattered across four tools
nobody checks before aping in.

Worse: even when you find a "safety score", you can't trust it. Audits are paid
for, followers are bought, Telegram groups are filled with bots. Anyone can
publish a page claiming they're safe.

PolMad answers "is this going to hurt me?" twice — once with data, once with money.

---

## What's here

| Path | What it is |
|---|---|
| `contracts/` | Foundry project — 6 contracts, 39 tests |
| `web/` | Next.js app — Check, Calls, Feed, Leaderboard, Profile, Creator |
| `keeper/` | Node service that watches targets and resolves markets |

## The loops

1. **Check** — free, no wallet, any chain. Risk score with per-category sub-scores
   and a plain-language summary. Every report's hash is committed on-chain.
2. **Call** — open a market on a contract, stake MON on SAFE or RUG.
3. **Prove** — winners claim the losing pool. Caller Score and soulbound badges follow.
4. **Warn** — resolutions, odds swings and fresh deployments hit a public feed.
5. **Create** — launch a token that structurally cannot rug.

---

## How the report works

Six categories, scored **deterministically from observed evidence**:

| Category | Source |
|---|---|
| Ownership & admin control | bytecode + `owner()` |
| Mint & burn control | bytecode selectors (proxy-resolved) |
| Liquidity | GeckoTerminal pool data — depth, concentration, turnover |
| Source verification | Etherscan V2 |
| Community & social presence | GeckoTerminal + CoinGecko |
| Holder concentration | ⚠️ not implemented — see limitations |

Three design decisions worth knowing:

**The AI never produces a score.** An LLM asked for a risk number will confidently
invent one for a contract it knows nothing about. Scores are computed in
`web/src/lib/scoring.ts` from evidence we actually observed; the model only writes
the narrative, is given only what was gathered, and is instructed never to
introduce a fact or a number. With no API key it falls back to a deterministic
summary and the UI labels it as such.

**Proxies are resolved before judging.** Most scanners scan the proxy's own
bytecode and report "no mint function" for tokens that absolutely have one. PolMad
follows EIP-1967/1822 implementation slots first. If it can't, mint/pause/blacklist
report as *unknown* — never as *absent*.

**Missing data never reads as safe.** Unmeasured categories are excluded from the
average rather than counted as zero, and "we couldn't check" is always shown as
distinct from "it's fine". Social presence is scored asymmetrically for the same
reason: absence is strong evidence of risk, presence is weak evidence of safety,
because followers are purchasable.

---

## How a market resolves

RUG means **any** of these provably happened to the target inside the window:

1. A pool lost **>50%** of its token balance in a single transaction
2. Total supply grew **>20%** (mint backdoor)
3. A pause or blacklist action blocked transfers

Otherwise it resolves SAFE when the window closes. A RUG can be reported
mid-window — it already happened, so there's no reason to keep it bettable. SAFE
can only be reported after the window actually elapses.

Payouts are parimutuel: winners get their stake back plus a pro-rata share of the
losing pool. No house fee.

**Caller Score** weights a correct call inversely to how many people agreed with
you at stake time, so calling a rug alone is worth far more than joining a crowd
that was already right. This is what stops a project rallying its community to
vote itself safe.

---

## Creator mode

A rug-checker that shipped rugs would be indefensible, so launched tokens are
backdoor-free **by construction**:

- no owner, no admin, no roles → nothing to seize
- supply minted once in the constructor → cannot be inflated
- no mint / pause / blacklist → transfers can't be blocked
- no upgradeability → the code cannot change

`TokenFactory` is the only deployer of `LaunchpadToken`, so factory provenance
*is* the proof. A test asserts all ten backdoor selectors are absent. Every launch
auto-attests to `TrustRegistry`.

**What this does not protect against:** the creator holds 100% of supply at launch
and can still sell it, never add liquidity, or pull liquidity they added. No token
contract can prevent that. A clean contract is not a trustworthy project.

---

## Deployed contracts (Monad testnet — chain 10143)

| Contract | Address | Verified |
|---|---|---|
| PropheyMarket | `0xe9fE71167F8D11aAE18845C426Bf4426a5930355` | ✅ |
| TrustRegistry | `0xFe134B092080430108112Df773A38Ed5173e8233` | ✅ |
| TokenFactory | `0x34E662C1E86500cFA510eecd1159c39Ef556386b` | ✅ |
| VerifierBadge | `0x694ac6329f88dafd4e8eddc9aea688574e08615b` | ✅ |
| MockRugToken *(demo only)* | `0x6bFc4E595AAca74DcF2F3Cda3c11a29021708752` | ✅ |

---

## Known limitations — stated plainly

- **The keeper is centralised.** One trusted off-chain service reports outcomes. A
  malicious or buggy operator could resolve a call incorrectly. The contract bounds
  the damage: if a call goes unresolved for 7 days past its window, **anyone** can
  call `voidCall` and every staker withdraws exactly what they staked. Production
  needs a decentralised keeper set or an oracle network.
- **RUG detection covers three patterns, not every exploit.** False negatives are
  expected. A call resolving SAFE is not a certificate.
- **Holder concentration is not implemented.** It needs a paid explorer tier or an
  indexer. It reports as unavailable and is excluded from the score — deliberately,
  because a guessed number that people bet money on is worse than an honest gap.
- **The score measures capability, not intent.** It asks "what could the owner do
  to you?", not "would they?". USDC scores HIGH RISK because Circle really can
  mint, pause and freeze. Read the sub-scores, not just the headline number. This
  is much of why the market layer exists.
- **Liquidity pools are never guessed.** They're looked up from a DEX index. A
  wrong pool address means watching the wrong balance and resolving incorrectly, so
  where no pools are found the trigger simply cannot fire — and the keeper says so.
- **Coverage varies by chain.** Ethereum and Base have full explorer coverage.
  Monad has no Etherscan-family API, so verification is unavailable there. Testnets
  have no market or social data at all.
- **The indexer is lightweight.** It scans forward once from the deployment block
  and persists — not a subgraph. Monad's public RPC caps log ranges at ~100 blocks
  and penalises parallelism, so history takes a few minutes to build on first run.
  Progress is shown honestly rather than rendering an empty leaderboard.

---

## Running it

### Contracts
```bash
cd contracts
forge install --no-git foundry-rs/forge-std
forge install --no-git OpenZeppelin/openzeppelin-contracts
forge test          # 39 tests
```

Deploy (needs a funded key — faucet at https://faucet.monad.xyz):
```bash
cast wallet import polmad-deployer --interactive

DEPLOY_MOCK=true forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --account polmad-deployer \
  --sender <YOUR_ADDRESS> \
  --broadcast
```

> `--sender` is required. Without it Foundry simulates as its default address and
> bakes that into every constructor — the deploy succeeds and is completely
> unusable. The script refuses to run rather than let that happen silently.

### Web
```bash
cd web
cp .env.example .env.local   # fill in keys + contract addresses
npm install --legacy-peer-deps
npm run dev
```

The Check page works with no keys and no contracts deployed — it degrades to
deterministic summaries rather than breaking.

### Keeper
```bash
cd keeper
npm install
cp .env.example .env         # PROPHEY_MARKET_ADDRESS + KEEPER_PRIVATE_KEY
npm start
```

The keeper key must match the `resolver` address set at deploy time.

### Deploying to Vercel
See [DEPLOY.md](./DEPLOY.md). Two things differ on serverless: storage needs Redis
(the filesystem is read-only), and the indexer runs on cron instead of a timer. The
keeper cannot run on Vercel at all — it needs a persistent process.

---

## Demo

`MockRugToken` exists so the resolution flow can be shown live rather than waiting
for a real rug during a 3-minute demo:

1. Start the keeper.
2. Open a call on the mock token with a 1-hour window.
3. Stake on both sides.
4. From the owner wallet, call `mint()` to inflate supply past 20%.
5. The keeper detects it and resolves automatically.
6. Claim — real MON moves on-chain.

Order matters: the keeper snapshots supply when it first sees a call, so create the
call **before** minting.

---

## Security notes

- Badges are **soulbound**. Reputation you can buy is not reputation.
- The market owner can rotate the resolver but **cannot touch escrowed funds** —
  there is no admin withdrawal path.
- Hedging both sides is allowed but can never be profitable.
- If nobody takes the winning side, the losing side is refunded rather than
  stranded in the contract.

**None of this is financial advice, and a PolMad report is not an audit.**

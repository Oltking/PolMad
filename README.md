# Polymad

**Paste an address. See the score. Bet on the outcome.**

A free, chain-agnostic contract risk checker, plus a Monad-native prediction market
where people stake real MON on whether a contract will rug — resolved automatically
from on-chain conditions, not human judgment.

The report gives you a first opinion. The market gives you a second one that is much
harder to fake, because faking it costs money and losing bets in public.

---

## What's here

| Path | What it is |
|---|---|
| `contracts/` | Foundry project — `TrustRegistry`, `PropheyMarket`, `VerifierBadge`, `MockRugToken` |
| `web/` | Next.js app — Check, Calls, Feed, Leaderboard, Profile, plus `/api/report` |
| `keeper/` | Node service that watches target contracts and resolves Calls |

## The four loops

1. **Check** — free, no wallet, any EVM chain. Paste an address, get a risk score with
   per-category sub-scores and a plain-language summary.
2. **Call** — connect a Monad wallet, open a Prophecy Call on a contract or stake on
   an existing one: SAFE or RUG.
3. **Prove** — when a Call resolves, winners claim their share of the losing pool.
   Caller Score and badges follow.
4. **Warn** — resolutions and large stakes hit a public feed anyone can read.

## How a Call resolves

RUG means **any** of these happened to the target inside the window:

1. A pool lost **>50%** of its token balance in a single transaction.
2. Total supply grew **>20%** (mint backdoor).
3. A pause or blacklist action blocked transfers.

Otherwise it resolves SAFE when the window closes. A RUG can be reported mid-window
— the rug already happened, so there's no reason to keep it bettable. SAFE can only
be reported after the window actually elapses.

## Known limitations — stated plainly

These are real and we're not hiding them.

- **The keeper is centralised.** One trusted off-chain service reports outcomes. A
  malicious or buggy operator could resolve a Call incorrectly. The contract bounds
  the damage but does not eliminate it: if a Call goes unresolved for 7 days past its
  window, **anyone** can call `voidCall` and every staker withdraws exactly what they
  staked. A production version needs a decentralised keeper set or an oracle network.
- **RUG detection covers three patterns, not every exploit.** A contract can harm you
  in ways none of these triggers catch. False negatives are expected. A Call resolving
  SAFE is not a certificate that a contract is safe.
- **Liquidity and holder-concentration sub-scores are not implemented.** They require
  DEX subgraph and indexer access that isn't wired up. They report as *unavailable*
  and are excluded from the overall score — deliberately, because averaging in an
  unchecked category as "fine" is how a scanner ends up blessing a contract it never
  inspected.
- **Liquidity pools are never guessed.** The keeper only watches pool addresses given
  to it in config. A wrong pool address means watching the wrong balance and resolving
  a Call incorrectly, which costs users real money — so if a pool is unknown, that
  trigger simply doesn't fire.
- **The score measures capability, not intent.** It asks "what could the owner do to
  you?", not "would they?". USDC scores HIGH RISK because Circle really can mint,
  pause, and freeze — factually true, and useless as a prediction that USDC will rug.
  A regulated issuer and an anonymous deployer with identical bytecode score
  identically. Read the sub-scores and findings, not just the headline number. This
  is a large part of why the market layer exists: people with context price in what
  a bytecode scan structurally cannot.
- **Cross-chain data quality varies.** Ethereum and Base have Etherscan coverage.
  Monad testnet doesn't, so reports there rely on on-chain reads alone and say so.
- **The report's numbers are not written by an LLM.** Scores are computed
  deterministically from observed evidence (`web/src/lib/scoring.ts`); the model only
  writes the narrative, is given only what was actually observed, and is instructed
  never to introduce a fact or a score. If no API key is present, a deterministic
  summary is used instead and the UI labels it as such.
- **The event reader is not a real indexer.** It's a `getLogs` sweep with a short
  cache, limited by RPC log retention.

## Setup

### 1. Contracts

```bash
cd contracts
forge test                  # 28 tests
```

Deploy to Monad testnet (needs a funded deployer — get MON at https://faucet.monad.xyz):

```bash
cast wallet import polymad-deployer --interactive   # paste your private key

RESOLVER=<keeper wallet address> \
MINTER=<backend wallet address> \
DEPLOY_MOCK=true \
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --account polymad-deployer \
  --broadcast
```

`RESOLVER` and `MINTER` both default to the deployer if unset. `DEPLOY_MOCK=true`
also deploys `MockRugToken` for the live demo.

Verify (all three explorers in one call):

```bash
forge verify-contract <ADDR> <NAME> --chain 10143 --show-standard-json-input > /tmp/si.json
# then POST to https://agents.devnads.com/v1/verify — see contracts/VERIFY.md
```

### 2. Web

```bash
cd web
cp .env.example .env.local   # fill in GROQ_API_KEY, ETHERSCAN_API_KEY, contract addresses
npm run dev
```

The Check page works with no keys and no contracts deployed — it degrades to
deterministic summaries and unavailable sub-scores rather than breaking.

### 3. Keeper

```bash
cd keeper
npm install
cp .env.example .env         # PROPHEY_MARKET_ADDRESS + KEEPER_PRIVATE_KEY
npm start                    # or `npm run once` for a single pass
```

The keeper key must be the address passed as `RESOLVER` at deploy time.

## Demo script

`MockRugToken` exists so the resolution flow can be shown live rather than waiting for
a real rug during a 3-minute demo:

1. Deploy with `DEPLOY_MOCK=true`.
2. Open a Call on the mock token with a 1-hour window.
3. Stake from two wallets — one SAFE, one RUG.
4. From the owner wallet, call `mint()` to inflate supply past 20%.
5. The keeper detects it and calls `resolve(callId, true)`.
6. The RUG staker claims — real MON moves on-chain, in front of the audience.

## Security notes

- Badges are **soulbound**. Reputation you can buy is not reputation.
- The market owner can rotate the resolver but **cannot touch escrowed funds** —
  there is no admin withdrawal path.
- Hedging both sides of a Call is allowed but can never be profitable; you only ever
  recover your winning leg plus its share, which your losing leg funded.
- If nobody takes the winning side, the losing side is refunded rather than having
  the pool stranded in the contract forever.

**None of this is financial advice, and a Polymad report is not an audit.**

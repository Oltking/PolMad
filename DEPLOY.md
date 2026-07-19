# Deploying PolMad to Vercel

## What changes on Vercel (read this first)

Vercel runs the app as serverless functions, which breaks two assumptions that
worked locally. Both are now handled, but you have to configure one of them.

**1. There is no writable disk.** The filesystem is read-only except `/tmp`, and
`/tmp` is per-invocation — anything written during one request is gone by the
next. The event index (leaderboard, profile, odds chart) needs to persist, so it
now uses Upstash Redis when configured. **Without Redis the index cannot
accumulate and the leaderboard will stay empty.** The UI reports this rather than
pretending the market is quiet.

**2. Background timers do not run.** The function freezes the instant it responds,
so the self-driving indexer used locally never fires. Vercel Cron calls
`/api/cron/index` every 5 minutes instead (configured in `vercel.json`).

**3. The keeper cannot run on Vercel at all.** It is a persistent polling process.
See "Hosting the keeper" below.

---

## Step 1 — Push to GitHub

```bash
cd ~/projects/PolMad
gh repo create polmad --private --source=. --push
```

Confirm `web/.env.local` and `keeper/.env` are NOT in the repo:

```bash
git ls-files | grep -E "\.env" && echo "STOP — secrets staged" || echo "clean"
```

## Step 2 — Create Redis (free)

1. Vercel dashboard → **Storage** → **Upstash Redis** → create
2. Connect it to the project — Vercel injects `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically

(Or create at upstash.com and set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.)

## Step 3 — Import the project

Vercel → Add New → Project → pick the repo. `vercel.json` already sets the build
commands and the cron, so no manual overrides are needed.

## Step 4 — Environment variables

Set these in Vercel → Settings → Environment Variables:

### Public (safe to expose — they are in the client bundle)
```
NEXT_PUBLIC_TRUST_REGISTRY=0xFe134B092080430108112Df773A38Ed5173e8233
NEXT_PUBLIC_PROPHEY_MARKET=0xe9fE71167F8D11aAE18845C426Bf4426a5930355
NEXT_PUBLIC_VERIFIER_BADGE=0x694ac6329f88dafd4e8eddc9aea688574e08615b
NEXT_PUBLIC_TOKEN_FACTORY=0x34E662C1E86500cFA510eecd1159c39Ef556386b
NEXT_PUBLIC_DEPLOY_BLOCK=46281923
NEXT_PUBLIC_WALLETCONNECT_ID=      # optional, from cloud.reown.com
```

### Server-only (never prefixed NEXT_PUBLIC — that would publish them)
```
GROQ_API_KEY=...
ETHERSCAN_API_KEY=...
ATTESTER_PRIVATE_KEY=0x...         # signs TrustRegistry attestations
BADGE_MINTER_PRIVATE_KEY=0x...     # mints VerifierBadge
CRON_SECRET=<random string>        # gates /api/cron/index
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
```

> **The two private keys are hot wallets.** They sign transactions on every report
> and badge mint. Use a dedicated testnet key holding only enough MON for gas —
> never a key with real funds, and never one you reuse elsewhere.

Generate the cron secret with `openssl rand -hex 32`.

## Step 5 — Verify after deploy

```bash
curl -s https://<your-app>.vercel.app/api/report?chainId=1&address=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 | head -c 300
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/index
```

The cron response shows `cursor` advancing toward `head`. It takes several
invocations (~15-30 min) to index the full history the first time. Until then the
leaderboard shows indexing progress honestly instead of an empty table.

---

## Hosting the keeper

The keeper must run continuously and **cannot** run on Vercel. Options:

| Option | Notes |
|---|---|
| **Local terminal** | Fine for a demo. `cd keeper && npm start`. Dies when you close the laptop. |
| **Railway / Render / Fly.io** | Free tiers run a persistent Node process. Point at `keeper/`, set the env from `keeper/.env.example`. |
| **A VPS** | Any small box with `pm2` or systemd. |

For hackathon judging, running it locally during the demo is honest and sufficient
— just say so. If nobody runs a keeper, calls go unresolved, and after 7 days past
the window anyone can call `voidCall` and every staker withdraws their original
stake. That is the designed failure mode, not a surprise.

---

## Known limitations in production

- **The keeper is a single trusted key.** It decides outcomes. Documented in the
  README; not solved by deploying.
- **Rate limits.** The Groq and GeckoTerminal free tiers will throttle under real
  traffic. `/api/logo` is rate-limited per IP; `/api/report` is not.
- **Monad's public RPC is slow and bursts get punished.** Indexing is deliberately
  paced. A paid RPC would make everything faster.
- **Holder concentration is still unavailable** — it needs a paid data source, and
  a guessed number would be worse than an honest gap.

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { useNetwork } from "@/lib/network-context";

/// Everything a creator needs to keep going, in one place.
///
/// The point of this screen is that nobody should have to come back here. Address,
/// ABI, metadata, logo files, verification command, wallet import, and a share post
/// are all one click away, because a launch tool that strands you at "deployed!"
/// has done half a job.
export function LaunchSuccess({
  token,
  txHash,
  name,
  symbol,
  supply,
  decimals,
  logoPng,
  logoSvg,
  onLaunchAnother,
}: {
  token: `0x${string}`;
  txHash: `0x${string}`;
  name: string;
  symbol: string;
  supply: string;
  decimals: number;
  logoPng?: string;
  logoSvg?: string;
  onLaunchAnother: () => void;
}) {
  const { network } = useNetwork();
  const { data: walletClient } = useWalletClient();
  const { connector } = useAccount();
  const explorer = network.chain.blockExplorers.default.url;

  const metadata = JSON.stringify(
    { name, symbol, decimals, address: token, chainId: network.id, image: logoPng ? "<png data uri>" : "", launchedVia: "polymad-launchpad-v1" },
    null,
    2,
  );

  const verifyCmd = `forge verify-contract ${token} LaunchpadToken \\
  --chain ${network.id} \\
  --verifier sourcify \\
  --verifier-url https://sourcify-api-monad.blockvision.org/`;

  const shareText = `I launched ${name} ($${symbol}) on @monad — with no mint function, no owner, and no pause switch.

It literally cannot rug. Verified on-chain by Polymad.

${explorer}/address/${token}`;

  async function addToWallet() {
    // EIP-747. Not every connector implements it, so failure is expected and
    // non-fatal — the address is on screen to paste manually.
    try {
      await walletClient?.request({
        method: "wallet_watchAsset",
        params: {
          type: "ERC20",
          options: { address: token, symbol, decimals, image: logoPng },
        },
      } as never);
    } catch {
      /* connector doesn't support it */
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="panel p-6 border-[var(--safe)]">
        <div className="flex flex-wrap items-center gap-4">
          {logoPng && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPng} alt="" className="w-20 h-20 border border-[var(--line)]" />
          )}
          <div className="min-w-0">
            <div className="text-[10px] tracking-widest text-[var(--safe)]">LAUNCHED</div>
            <h1 className="text-2xl font-bold">
              {name} <span className="text-[var(--muted)]">${symbol}</span>
            </h1>
            <p className="text-sm text-[var(--muted)] mt-1">
              {Number(supply).toLocaleString()} supply · now in your wallet
            </p>
          </div>
        </div>
      </div>

      <Section title="YOUR TOKEN">
        <CopyRow label="Contract address" value={token} />
        <CopyRow label="Transaction" value={txHash} />
        <div className="flex flex-wrap gap-2 pt-1">
          <ExternalBtn href={`${explorer}/address/${token}`}>VIEW ON EXPLORER ↗</ExternalBtn>
          <button onClick={addToWallet} className="btn-ghost">
            ADD TO {connector?.name?.toUpperCase() ?? "WALLET"}
          </button>
          <Link href={`/?chainId=${network.id}&address=${token}`} className="btn-ghost">
            RUN A RISK CHECK →
          </Link>
        </div>
      </Section>

      <Section title="BRAND ASSETS">
        {logoPng ? (
          <div className="flex flex-wrap gap-2">
            <a href={logoPng} download={`${symbol}-logo-512.png`} className="btn-ghost">
              PNG 512×512
            </a>
            {logoSvg && (
              <button
                onClick={() => downloadBlob(logoSvg, `${symbol}-logo.svg`, "image/svg+xml")}
                className="btn-ghost"
              >
                SVG (VECTOR)
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--muted)]">No logo was generated for this launch.</p>
        )}
      </Section>

      <Section title="FOR DEVELOPERS">
        <CopyBlock label="Token metadata JSON" value={metadata} />
        <CopyBlock label="Verify the contract source" value={verifyCmd} />
        <p className="text-[10px] text-[var(--muted)]">
          Verifying publishes your source so anyone can read exactly what they are buying. It costs
          nothing and takes a minute — for a token whose entire pitch is &quot;no backdoors&quot;, it
          is worth doing today.
        </p>
      </Section>

      <Section title="TELL PEOPLE">
        <CopyBlock label="Post" value={shareText} />
        <ExternalBtn href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}>
          SHARE ON X ↗
        </ExternalBtn>
      </Section>

      <Section title="WHAT TO DO NEXT">
        <ol className="text-[11px] text-[var(--muted)] space-y-1.5 leading-relaxed">
          <li>
            <span className="text-[var(--fg)]">1. Verify the contract</span> — use the command above.
          </li>
          <li>
            <span className="text-[var(--fg)]">2. Add liquidity</span> — a token nobody can trade has
            no price. Pair it on a DEX with real depth.
          </li>
          <li>
            <span className="text-[var(--fg)]">3. Lock or burn your LP</span> — this is the risk you
            still control. Holders can see whether you did, and it is the single strongest signal
            you can give them.
          </li>
          <li>
            <span className="text-[var(--fg)]">4. Open a Prophecy Call on yourself</span> — invite
            the market to price your project&apos;s safety publicly. Confidence is cheap; a live
            market that says SAFE is not.
          </li>
        </ol>
      </Section>

      <div className="flex gap-2">
        <button onClick={onLaunchAnother} className="flex-1 py-2.5 text-sm border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]">
          LAUNCH ANOTHER
        </button>
        <Link href="/launches" className="flex-1 py-2.5 text-sm font-bold bg-[var(--acid)] text-black text-center">
          SEE ALL LAUNCHES
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5 space-y-3">
      <h2 className="text-xs tracking-widest text-[var(--muted)]">{title}</h2>
      {children}
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-[var(--muted)] w-32 shrink-0">{label}</span>
      <span className="flex-1 break-all">{value}</span>
      <CopyButton value={value} />
    </div>
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--muted)]">{label}</span>
        <CopyButton value={value} />
      </div>
      <pre className="text-[10px] bg-[var(--surface-2)] border border-[var(--line)] p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {value}
      </pre>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — text is selectable on screen */
        }
      }}
      className="shrink-0 px-2 py-0.5 text-[10px] border border-[var(--line)] hover:border-[var(--acid)] hover:text-[var(--acid)]"
    >
      {copied ? "COPIED" : "COPY"}
    </button>
  );
}

function ExternalBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="btn-ghost">
      {children}
    </a>
  );
}

function downloadBlob(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

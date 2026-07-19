"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { useNetwork } from "@/lib/network-context";
import { tokenFactoryAbi } from "@/lib/contracts";
import { isDeployed } from "@/lib/networks";
import { LaunchSuccess } from "@/components/LaunchSuccess";

/// Creator mode — launch a token that cannot rug.
///
/// Three steps, deliberately: identity, logo, review. Anything longer and people
/// abandon; anything shorter and they deploy something they did not read.

type Step = 1 | 2 | 3;

export default function CreatePage() {
  const { address, chainId } = useAccount();
  const { network } = useNetwork();
  const publicClient = usePublicClient({ chainId: network.id });
  const factory = network.deployment.tokenFactory;

  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000");
  const [decimals] = useState(18);

  const [brief, setBrief] = useState("");
  const [logo, setLogo] = useState<{ svg: string; png: string; model: string } | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState("");

  const [launchedToken, setLaunchedToken] = useState<`0x${string}` | null>(null);

  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: txHash });

  const wrongChain = chainId !== network.id;
  const factoryLive = isDeployed(factory);
  const supplyValid = /^\d+$/.test(supply.trim()) && BigInt(supply.trim() || "0") > 0n;
  const step1Valid = name.trim().length > 0 && symbol.trim().length > 0 && supplyValid;

  async function generateLogo() {
    setLogoLoading(true);
    setLogoError("");
    try {
      const res = await fetch("/api/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, symbol, brief }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Logo generation failed");
      setLogo({ svg: json.svg, png: json.png, model: json.model });
    } catch (err) {
      setLogoError((err as Error).message);
    } finally {
      setLogoLoading(false);
    }
  }

  async function launch() {
    if (!address || !publicClient) return;

    // Metadata is embedded as a data URI so a launch never depends on our server
    // staying up. The token's own metadataURI must outlive this app.
    const metadata = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      decimals,
      image: logo?.png ?? "",
      description: brief.trim(),
      launchedVia: "polmad-launchpad-v1",
    };
    const metadataURI = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(metadata))))}`;

    writeContract(
      {
        address: factory,
        abi: tokenFactoryAbi,
        functionName: "createToken",
        args: [
          name.trim(),
          symbol.trim().toUpperCase(),
          decimals,
          parseUnits(supply.trim(), decimals),
          metadataURI,
        ],
      },
      {
        onSuccess: async (hash) => {
          // Read the token address back from the receipt logs rather than guessing
          // it — CREATE addresses depend on factory nonce and must not be assumed.
          try {
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            const log = receipt.logs.find((l) => l.address.toLowerCase() === factory.toLowerCase());
            const topic = log?.topics?.[1];
            if (topic) setLaunchedToken(`0x${topic.slice(-40)}` as `0x${string}`);
          } catch {
            /* the success screen degrades to showing just the tx hash */
          }
        },
      },
    );
  }

  if (launchedToken) {
    return (
      <LaunchSuccess
        token={launchedToken}
        txHash={txHash!}
        name={name}
        symbol={symbol.toUpperCase()}
        supply={supply}
        decimals={decimals}
        logoPng={logo?.png}
        logoSvg={logo?.svg}
        onLaunchAnother={() => {
          setLaunchedToken(null);
          setStep(1);
          setName("");
          setSymbol("");
          setLogo(null);
          reset();
        }}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold leading-tight">
          Launch a token that <span className="text-[var(--safe)]">cannot rug</span>.
        </h1>
        <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
          No owner. No mint function. No pause. No blacklist. Not a promise — the contract
          physically has no code to do those things, and every launch writes proof of that
          on-chain to PolMad&apos;s TrustRegistry.
        </p>
      </div>

      <Steps step={step} />

      {!factoryLive && (
        <div className="panel p-4 text-[11px] text-[var(--warn)]">
          The launchpad is not deployed on {network.label} yet. You can design a logo here, but
          launching needs the factory contract. Switch networks in the header, or deploy it.
        </div>
      )}

      {step === 1 && (
        <section className="panel p-5 space-y-4">
          <Field label="TOKEN NAME" hint="The full name, e.g. Solar Protocol">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              placeholder="Solar Protocol"
              className="input"
            />
          </Field>

          <Field label="TICKER" hint="2–6 characters, e.g. SOLR">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              maxLength={12}
              placeholder="SOLR"
              className="input"
            />
          </Field>

          <Field label="TOTAL SUPPLY" hint="Fixed forever. This exact number is minted to you, once.">
            <input
              value={supply}
              onChange={(e) => setSupply(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="input"
            />
          </Field>
          {supply && supplyValid && (
            <p className="text-[10px] text-[var(--muted)]">
              {Number(supply).toLocaleString()} {symbol || "tokens"}, {decimals} decimals — all sent
              to your wallet at launch.
            </p>
          )}

          <button
            onClick={() => setStep(2)}
            disabled={!step1Valid}
            className="w-full py-2.5 text-sm font-bold bg-[var(--acid)] text-black disabled:opacity-40"
          >
            NEXT — DESIGN THE LOGO
          </button>
        </section>
      )}

      {step === 2 && (
        <section className="panel p-5 space-y-4">
          <Field label="LOGO DIRECTION" hint="Optional. A few words on mood, symbol, or colour.">
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              maxLength={300}
              placeholder="sun, sharp geometry, high contrast"
              className="input"
            />
          </Field>

          <div className="flex flex-wrap gap-3 items-start">
            <div
              className="w-40 h-40 shrink-0 border border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-center overflow-hidden"
              aria-label="Logo preview"
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo.png} alt={`${name} logo`} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[10px] text-[var(--muted)] text-center px-2">
                  {logoLoading ? "drawing…" : "no logo yet"}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-[12rem] space-y-2">
              <button
                onClick={generateLogo}
                disabled={logoLoading}
                className="w-full py-2 text-xs font-bold border border-[var(--acid)] text-[var(--acid)] hover:bg-[var(--acid)] hover:text-black disabled:opacity-40"
              >
                {logoLoading ? "GENERATING…" : logo ? "GENERATE ANOTHER" : "GENERATE LOGO"}
              </button>

              {logo && (
                <div className="text-[10px] text-[var(--muted)] space-y-1">
                  <div>512×512 PNG · drawn as SVG by {logo.model}</div>
                  <div className="flex gap-2">
                    <a href={logo.png} download={`${symbol || "token"}-logo.png`} className="text-[var(--acid)] hover:underline">
                      download PNG
                    </a>
                    <button
                      onClick={() => downloadText(logo.svg, `${symbol || "token"}-logo.svg`)}
                      className="text-[var(--acid)] hover:underline"
                    >
                      download SVG
                    </button>
                  </div>
                </div>
              )}
              {logoError && <p className="text-[11px] text-[var(--rug)]">{logoError}</p>}
              <p className="text-[10px] text-[var(--muted)] leading-relaxed">
                The agent writes vector art, so it produces bold geometric marks rather than
                illustration. Regenerate freely — it is free and takes seconds.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 text-sm border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]">
              BACK
            </button>
            <button
              onClick={() => setStep(3)}
              className="flex-1 py-2.5 text-sm font-bold bg-[var(--acid)] text-black"
            >
              {logo ? "NEXT — REVIEW" : "SKIP LOGO"}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="panel p-5 space-y-4">
          <h2 className="text-xs tracking-widest text-[var(--muted)]">REVIEW — THIS IS PERMANENT</h2>

          <div className="flex gap-4 items-center">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.png} alt="" className="w-16 h-16 border border-[var(--line)]" />
            )}
            <div>
              <div className="text-lg font-bold">{name}</div>
              <div className="text-sm text-[var(--muted)]">
                {symbol.toUpperCase()} · {Number(supply).toLocaleString()} supply
              </div>
            </div>
          </div>

          <div className="border border-[var(--line)] bg-[var(--surface-2)] p-3 space-y-1 text-[10px]">
            <Row label="factory" value={factory} />
            <Row label="network" value={`${network.label} (${network.id})`} />
            <Row label="decimals" value={String(decimals)} />
            <Row label="mint to" value={address ?? "connect wallet"} />
          </div>

          <div className="border border-[var(--safe)] p-3 space-y-1">
            <div className="text-[10px] tracking-widest text-[var(--safe)]">GUARANTEED BY THE CONTRACT</div>
            <ul className="text-[10px] text-[var(--muted)] space-y-0.5 mt-1">
              <li>— Supply is fixed at launch and can never increase</li>
              <li>— No owner or admin exists, so nothing can be seized or paused</li>
              <li>— Transfers can never be blocked or blacklisted</li>
              <li>— Code is not upgradeable; what deploys is what stays</li>
            </ul>
          </div>

          <div className="border border-[var(--warn)] p-3">
            <div className="text-[10px] tracking-widest text-[var(--warn)]">WHAT THIS DOES NOT PROTECT AGAINST</div>
            <p className="text-[10px] text-[var(--muted)] mt-1 leading-relaxed">
              You will hold 100% of supply at launch. Holders are still exposed to you selling it,
              never adding liquidity, or removing liquidity you add. No token contract can prevent
              that — a clean contract is not the same thing as a trustworthy project.
            </p>
          </div>

          {!address && <p className="text-[11px] text-[var(--warn)]">Connect a wallet to launch.</p>}
          {wrongChain && address && (
            <p className="text-[11px] text-[var(--warn)]">Switch your wallet to {network.label}.</p>
          )}
          {error && (
            <p className="text-[11px] text-[var(--rug)] break-words">
              {(error as { shortMessage?: string }).shortMessage ?? error.message}
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 text-sm border border-[var(--line)] text-[var(--muted)] hover:text-[var(--fg)]">
              BACK
            </button>
            <button
              onClick={launch}
              disabled={!address || wrongChain || !factoryLive || isPending || confirming}
              className="flex-1 py-2.5 text-sm font-bold bg-[var(--acid)] text-black disabled:opacity-40"
            >
              {isPending ? "CONFIRM IN WALLET…" : confirming ? "LAUNCHING…" : "LAUNCH TOKEN"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const labels = ["IDENTITY", "LOGO", "REVIEW"];
  return (
    <div className="flex gap-2">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const active = n === step;
        const done = n < step;
        return (
          <div
            key={l}
            className="flex-1 py-1.5 px-2 text-[10px] tracking-widest border text-center"
            style={{
              borderColor: active ? "var(--acid)" : "var(--line)",
              color: active ? "var(--acid)" : done ? "var(--safe)" : "var(--muted)",
            }}
          >
            {done ? "✓ " : `${n}. `}
            {l}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-[var(--muted)] tracking-widest">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-[var(--muted)] mt-1">{hint}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  );
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

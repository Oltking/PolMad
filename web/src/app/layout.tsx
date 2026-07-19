import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";
import { WalletButton } from "@/components/WalletButton";
import { NetworkSwitch } from "@/components/NetworkSwitch";
import { ModeSwitch } from "@/components/ModeSwitch";
import { ModeNav } from "@/components/ModeNav";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Polymad — paste an address, see the score, bet the outcome",
  description:
    "Free cross-chain contract risk reports, plus a Monad-native prediction market where people stake real MON on whether a contract rugs.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col grid-bg">
        <Providers>
          <header className="border-b border-[var(--line)] sticky top-0 z-40 bg-[var(--bg)]/95 backdrop-blur">
            <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
              <Link href="/" className="font-bold tracking-tight text-[var(--acid)] shrink-0">
                POLYMAD
              </Link>
              <ModeSwitch />
              <ModeNav />
              <div className="ml-auto shrink-0 flex items-center gap-2">
                <NetworkSwitch />
                <WalletButton />
              </div>
            </div>
          </header>

          <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8">{children}</main>

          <footer className="border-t border-[var(--line)] mt-12">
            <div className="mx-auto max-w-6xl px-4 py-5 text-[11px] leading-relaxed text-[var(--muted)] space-y-1">
              <p>
                Risk reports are automated signals derived from public data — not an audit, and not
                financial advice. Absence of a warning is not proof a contract is safe.
              </p>
              <p>
                Calls resolve from deterministic on-chain conditions, reported by a single trusted
                keeper. That keeper is centralised in this build; see the README.
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

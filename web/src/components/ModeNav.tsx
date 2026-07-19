"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/// Nav follows the active mode, so a creator never wades through leaderboards and
/// a trader never sees launch tooling. Same header, two products.
const RADAR_NAV = [
  { href: "/", label: "CHECK" },
  { href: "/calls", label: "CALLS" },
  { href: "/feed", label: "FEED" },
  { href: "/leaderboard", label: "LEADERBOARD" },
];

const CREATOR_NAV = [
  { href: "/create", label: "LAUNCH" },
  { href: "/launches", label: "LAUNCHES" },
];

export function ModeNav() {
  const pathname = usePathname();
  const inCreator = pathname.startsWith("/create") || pathname.startsWith("/launches");
  const items = inCreator ? CREATOR_NAV : RADAR_NAV;

  return (
    <nav className="flex gap-4 text-xs text-[var(--muted)] overflow-x-auto order-3 sm:order-none w-full sm:w-auto pb-1 sm:pb-0">
      {items.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className="hover:text-[var(--fg)] whitespace-nowrap py-1"
            style={active ? { color: "var(--fg)" } : undefined}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Briefcase,
  Eye,
  Clock,
} from "lucide-react";

const tabItems = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/trade", label: "Trade", icon: TrendingUp },
  { href: "/portfolios", label: "Portfolios", icon: Briefcase },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/history", label: "History", icon: Clock },
];

/**
 * Fixed glass bottom tab bar for mobile (hidden on sm:+).
 * Five primary destinations; secondary links live in the top-header menu.
 */
export default function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 sm:hidden glass border-t border-glass-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="flex items-stretch justify-around px-1 pt-1.5 pb-1">
        {tabItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 transition-colors ${
                  active
                    ? "text-emerald-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <span
                  className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-all ${
                    active ? "bg-emerald-400/10 shadow-glow-sm" : ""
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-[10px] font-medium tracking-tight">
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

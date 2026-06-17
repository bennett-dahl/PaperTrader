"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Eye,
  Briefcase,
  LogOut,
  Wand2,
  Zap,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import SidebarPortfolioPicker from "@/components/SidebarPortfolioPicker";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/trade", label: "Trade", icon: TrendingUp },
  { href: "/advisor", label: "Advisor", icon: Wand2 },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/portfolios", label: "Portfolios", icon: Briefcase },
  { href: "/pipelines", label: "Pipelines", icon: Zap },
];

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  portfolios: { id: string; name: string }[];
}

export default function Sidebar({ user, portfolios }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden sm:flex fixed left-0 top-0 h-full w-64 glass border-r border-glass-border flex-col z-10">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-6 py-5 border-b border-glass-border">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-400/10 shadow-glow-sm">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
        </span>
        <span className="text-lg font-semibold tracking-tight text-gradient">PaperTrader</span>
      </div>

      {/* Active portfolio */}
      <div className="px-3 py-3 border-b border-glass-border">
        <SidebarPortfolioPicker portfolios={portfolios} />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all min-h-[44px] ${
                active
                  ? "bg-emerald-400/10 text-emerald-400 shadow-glow-sm"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-emerald-400" />
              )}
              <Icon className="h-5 w-5 flex-shrink-0" />
              <span className="font-medium text-sm">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="border-t border-glass-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8 ring-1 ring-glass-border">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback>
              {user.name?.charAt(0).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex items-center gap-2 text-slate-500 hover:text-white text-sm transition-colors w-full px-2 py-1.5 rounded-lg hover:bg-white/5 min-h-[44px]"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}

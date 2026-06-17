"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Check, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useActivePortfolio } from "@/contexts/ActivePortfolioContext";

interface PortfolioPillProps {
  portfolios: { id: string; name: string }[];
}

export default function PortfolioPill({ portfolios }: PortfolioPillProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { activePortfolioId, setActivePortfolioId } = useActivePortfolio();
  const [open, setOpen] = useState(false);

  if (portfolios.length === 0) return null;

  const active =
    portfolios.find((p) => p.id === activePortfolioId) ?? portfolios[0];
  const onDashboard = pathname === "/dashboard";

  // Single portfolio: static pill that routes to portfolio management.
  if (portfolios.length === 1) {
    return (
      <button
        type="button"
        onClick={() => router.push("/portfolios")}
        className="flex min-w-0 items-center gap-1.5 rounded-full border border-glass-border bg-white/5 px-3 py-1 text-sm text-slate-200 transition-colors hover:bg-white/10"
      >
        <span className="truncate">{active.name}</span>
      </button>
    );
  }

  const handleSelect = (id: string) => {
    setActivePortfolioId(id);
    setOpen(false);
    if (onDashboard) router.push(`?portfolio=${id}`);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex min-w-0 items-center gap-1.5 rounded-full border border-glass-border bg-white/5 px-3 py-1 text-sm text-slate-200 transition-colors hover:bg-white/10"
      >
        <span className="truncate">{active.name}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="glass rounded-t-2xl border-glass-border pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetHeader className="pb-1">
            <SheetTitle className="text-slate-200">Switch portfolio</SheetTitle>
          </SheetHeader>

          <ul className="flex flex-col px-2 pb-2">
            {portfolios.map((p) => {
              const isActive = p.id === active.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(p.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors ${
                      isActive
                        ? "bg-emerald-400/10 text-emerald-400"
                        : "text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-emerald-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {p.name}
                    </span>
                    {isActive && <Check className="h-4 w-4 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-glass-border px-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/portfolios");
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="font-medium">New portfolio</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

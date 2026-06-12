"use client";

import {
  portfolioTotalValue,
  portfolioPnL,
  portfolioPnLPct,
} from "@/lib/portfolio-utils";

export interface PositionBannerProps {
  cashBalance: number;
  startingBalance: number;
  holdingsValue: number;
}

export default function PositionBanner({
  cashBalance,
  startingBalance,
  holdingsValue,
}: PositionBannerProps) {
  const totalValue = portfolioTotalValue(cashBalance, [
    { shares: 1, currentPrice: holdingsValue },
  ]);
  const pnl = portfolioPnL(totalValue, startingBalance);
  const pnlPct = portfolioPnLPct(totalValue, startingBalance);
  const isUp = pnl >= 0;

  return (
    <div
      className="rounded-3xl p-px shadow-glass"
      style={{
        backgroundImage:
          "linear-gradient(135deg, color-mix(in oklch, var(--positive) 55%, transparent), color-mix(in oklch, var(--chart-4) 45%, transparent) 55%, color-mix(in oklch, var(--chart-3) 35%, transparent))",
      }}
    >
      <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] glass p-5 space-y-4">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full opacity-40 blur-3xl"
          style={{ background: "var(--positive)" }}
        />
        <div className="relative">
          <p className="text-slate-400 text-xs uppercase tracking-wider">Total Portfolio Value</p>
          <p className="tabular mt-1.5 font-semibold tracking-tight leading-none text-[clamp(2.25rem,9vw,3rem)]">
            $
            {totalValue.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span
              className={`tabular text-sm font-semibold px-2.5 py-1 rounded-full ${
                isUp
                  ? "bg-emerald-500/20 text-emerald-400 shadow-glow-sm"
                  : "bg-red-500/20 text-red-400 shadow-glow-negative"
              }`}
            >
              {isUp ? "+" : ""}
              {isUp ? "+" : "-"}{Math.abs(pnlPct).toFixed(2)}%
            </span>
            <span className={`tabular text-sm ${isUp ? "text-emerald-400" : "text-red-400"}`}>
              {isUp ? "+" : "-"}${Math.abs(pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} all time
            </span>
          </div>
        </div>

        <div className="relative flex gap-4 pt-3 border-t border-glass-border">
          <div className="flex-1">
            <p className="text-slate-500 text-xs uppercase tracking-wider">Cash</p>
            <p className="tabular font-semibold text-sm mt-1">
              $
              {cashBalance.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-slate-500 text-xs uppercase tracking-wider">Invested</p>
            <p className="tabular font-semibold text-sm mt-1">
              $
              {holdingsValue.toLocaleString("en-US", {
                minimumFractionDigits: 2,
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

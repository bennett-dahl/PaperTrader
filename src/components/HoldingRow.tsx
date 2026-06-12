"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { StockDetailSheet } from "@/components/stock-detail/StockDetailSheet";
import { useActivePortfolio } from "@/contexts/ActivePortfolioContext";

interface HoldingRowProps {
  ticker: string;
  name?: string;
  shares: number;
  avgCostBasis: number;
  portfolioId: string;
  currentPrice?: number;
  change?: number;
  changePercent?: number;
}

export default function HoldingRow({
  ticker,
  name,
  shares,
  avgCostBasis,
  portfolioId,
  currentPrice,
  change,
  changePercent,
}: HoldingRowProps) {
  const [open, setOpen] = useState(false);
  const { activePortfolioId } = useActivePortfolio();

  const price = currentPrice ?? avgCostBasis;
  const currentValue = shares * price;
  const costBasis = shares * avgCostBasis;
  const gainLoss = currentValue - costBasis;
  const gainLossPct = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
  const isUp = gainLoss >= 0;

  const effectivePortfolioId = portfolioId ?? activePortfolioId ?? "";

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="glass rounded-2xl px-4 py-4 cursor-pointer transition-all hover:bg-white/[0.07] active:scale-[0.99]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center rounded-lg bg-white/5 px-2 py-0.5 font-mono text-sm font-semibold tracking-tight ring-1 ring-glass-border">
              {ticker}
            </p>
            {name && (
              <p className="text-slate-500 text-xs mt-1 truncate max-w-[140px]">
                {name}
              </p>
            )}
            <p className="tabular text-slate-500 text-xs mt-1">
              {shares % 1 === 0 ? shares.toFixed(0) : shares.toFixed(4)} shares · avg $
              {avgCostBasis.toFixed(2)}
            </p>
          </div>
          <div className="text-right">
            <p className="tabular font-semibold">
              $
              {currentValue.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
            {currentPrice != null && (
              <p className="tabular text-slate-400 text-xs mt-0.5">
                ${currentPrice.toFixed(2)}/share
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-glass-border">
          <div className="flex items-center gap-1.5">
            {isUp ? (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-red-400" />
            )}
            <span
              className={`tabular text-sm font-semibold ${
                isUp ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {isUp ? "+" : ""}${Math.abs(gainLoss).toFixed(2)} ({isUp ? "+" : ""}
              {gainLossPct.toFixed(2)}%)
            </span>
          </div>
          {changePercent != null && (
            <span
              className={`tabular text-xs ${
                changePercent >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              Today: {changePercent >= 0 ? "+" : ""}
              {changePercent.toFixed(2)}%
            </span>
          )}
          {change == null && currentPrice == null && (
            <span className="text-slate-600 text-xs">Tap for details</span>
          )}
        </div>
      </div>

      <StockDetailSheet
        open={open}
        onClose={() => setOpen(false)}
        ticker={ticker}
        stockName={name}
        context="holdings"
        holding={{
          shares,
          avgCost: avgCostBasis,
          portfolioId: effectivePortfolioId,
        }}
      />
    </>
  );
}

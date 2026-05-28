"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import PortfolioCard from "@/components/PortfolioCard";
import HoldingRow from "@/components/HoldingRow";
import { HoldingWithPrice } from "@/types";

interface LivePortfolioDashboardProps {
  portfolioId: string;
  initialHoldings: HoldingWithPrice[];
  initialCashBalance: number;
  initialTotalValue: number;
  startingBalance: number;
}

interface LiveQuote {
  price: number;
  change: number;
  changePercent: number;
  name?: string;
  stale: boolean;
}

function formatLastUpdated(date: Date | null): string {
  if (!date) return "";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  return `${diffMin} min ago`;
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 10;
const BATCH_STAGGER_MS = 500;

export default function LivePortfolioDashboard({
  portfolioId,
  initialHoldings,
  initialCashBalance,
  initialTotalValue: _initialTotalValue,
  startingBalance,
}: LivePortfolioDashboardProps) {
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>(initialHoldings);
  const [cashBalance, setCashBalance] = useState(initialCashBalance);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuote>>({});
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedDisplay, setLastUpdatedDisplay] = useState("");
  const mountedRef = useRef(true);

  // Update "X min ago" display every 30s
  useEffect(() => {
    const tick = () => {
      if (lastUpdated) setLastUpdatedDisplay(formatLastUpdated(lastUpdated));
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  // Live total value via useMemo
  const totalValue = useMemo(() => {
    const holdingsValue = holdings.reduce((sum, h) => {
      const live = liveQuotes[h.ticker];
      const price = live?.price ?? h.currentPrice ?? h.avgCostBasis;
      return sum + h.shares * price;
    }, 0);
    return holdingsValue + cashBalance;
  }, [holdings, cashBalance, liveQuotes]);

  const holdingsValue = totalValue - cashBalance;
  const totalReturn = totalValue - startingBalance;
  const totalReturnPct = startingBalance > 0 ? (totalReturn / startingBalance) * 100 : 0;

  const refreshQuotes = useCallback(async (currentHoldings: HoldingWithPrice[]) => {
    if (currentHoldings.length === 0) return;
    if (!mountedRef.current) return;

    setIsRefreshing(true);

    const tickers = currentHoldings.map((h) => h.ticker);
    const batches: string[][] = [];
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      batches.push(tickers.slice(i, i + BATCH_SIZE));
    }

    const merged: Record<string, LiveQuote> = {};

    for (let i = 0; i < batches.length; i++) {
      if (!mountedRef.current) break;
      if (i > 0) {
        await new Promise((res) => setTimeout(res, BATCH_STAGGER_MS));
      }
      try {
        const res = await fetch(`/api/quotes?tickers=${batches[i].join(",")}`);
        if (!res.ok) continue;
        const data = await res.json();
        Object.assign(merged, data.quotes ?? {});
      } catch (err) {
        console.error("[LivePortfolioDashboard] Quote fetch error:", err);
      }
    }

    if (!mountedRef.current) return;

    setLiveQuotes((prev) => ({ ...prev, ...merged }));
    setLastUpdated(new Date());
    setIsRefreshing(false);
  }, []);

  // Re-fetch holdings when portfolioId changes
  useEffect(() => {
    async function fetchHoldings() {
      try {
        const res = await fetch(`/api/holdings?portfolioId=${portfolioId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!mountedRef.current) return;
        setHoldings(data.holdings ?? []);
        setCashBalance(data.cashBalance ?? 0);
      } catch (err) {
        console.error("[LivePortfolioDashboard] Holdings fetch error:", err);
      }
    }

    fetchHoldings();
  }, [portfolioId]);

  // Auto-refresh quotes: immediate on mount + every 5 min
  useEffect(() => {
    mountedRef.current = true;
    refreshQuotes(holdings);
    const id = setInterval(() => {
      refreshQuotes(holdings);
    }, REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-refresh quotes when holdings change (e.g. after portfolioId switch)
  const holdingsKey = holdings.map((h) => h.ticker).join(",");
  useEffect(() => {
    if (holdings.length > 0) {
      refreshQuotes(holdings);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingsKey]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <PortfolioCard
          totalValue={totalValue}
          cashBalance={cashBalance}
          holdingsValue={holdingsValue}
          totalReturn={totalReturn}
          totalReturnPct={totalReturnPct}
        />
        {/* Last updated / refreshing indicator */}
        <div className="flex items-center gap-2 mt-2 px-1">
          {isRefreshing ? (
            <div className="flex items-center gap-1.5 text-slate-500 text-xs">
              <svg
                className="animate-spin h-3 w-3 text-slate-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span>Refreshing prices…</span>
            </div>
          ) : lastUpdated ? (
            <p className="text-slate-600 text-xs">
              Prices updated {lastUpdatedDisplay}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Holdings</h2>
        {holdings.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
            <p className="text-slate-400 mb-1">No holdings yet</p>
            <p className="text-slate-500 text-sm">
              Head to Trade to make your first buy
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {holdings.map((holding) => {
              const live = liveQuotes[holding.ticker];
              return (
                <HoldingRow
                  key={holding.ticker}
                  ticker={holding.ticker}
                  name={(live?.name ?? holding.name) || undefined}
                  shares={holding.shares}
                  avgCostBasis={holding.avgCostBasis}
                  portfolioId={portfolioId}
                  currentPrice={live?.price ?? holding.currentPrice}
                  change={live?.change ?? holding.change}
                  changePercent={live?.changePercent ?? holding.changePercent}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

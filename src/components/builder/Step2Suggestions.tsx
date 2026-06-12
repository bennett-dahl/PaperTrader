"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, ChevronRight, Loader2, ArrowLeftRight } from "lucide-react";
import { StockDetailSheet } from "@/components/stock-detail/StockDetailSheet";
import type { SuggestionItem, BuildConfig } from "./PortfolioBuilderWizard";

interface Step2SuggestionsProps {
  config: BuildConfig;
  onBack: () => void;
  onConfirm: (items: SuggestionItem[]) => void;
}

export default function Step2Suggestions({ config, onBack, onConfirm }: Step2SuggestionsProps) {
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [swappingTicker, setSwappingTicker] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // StockDetail state for builder context
  const [detailTicker, setDetailTicker] = useState<string | null>(null);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailSlotIndex, setDetailSlotIndex] = useState<number>(-1);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        portfolioId: config.portfolioId,
        amount: String(config.amount),
        riskLevel: config.riskLevel,
        count: String(config.stockCount),
      });
      if (config.categories.length > 0) {
        params.set("categories", config.categories.join(","));
      }

      const res = await fetch(`/api/suggest?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to get suggestions");
        return;
      }

      setSuggestions(data.suggestions ?? []);
    } catch {
      setError("Failed to get suggestions. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  const handleSwap = async (ticker: string) => {
    setSwappingTicker(ticker);
    try {
      const res = await fetch("/api/suggest/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioId: config.portfolioId,
          tickerToReplace: ticker,
          excludeTickers: suggestions.map((s) => s.ticker),
          amount: config.amount,
          riskLevel: config.riskLevel,
          categories: config.categories,
          perStockAmount: config.amount / config.stockCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Swap failed");
        return;
      }

      setSuggestions((prev) =>
        prev.map((s) => (s.ticker === ticker ? data.suggestion : s))
      );
    } catch {
      toast.error("Swap failed. Try again.");
    } finally {
      setSwappingTicker(null);
    }
  };

  // Open StockDetail in builder context for a suggestion slot
  const handleViewDetail = (item: SuggestionItem, slotIndex: number) => {
    setDetailTicker(item.ticker);
    setDetailName(item.name);
    setDetailSlotIndex(slotIndex);
  };

  // Called when user confirms "Swap In" from StockDetail
  const handleSwapIn = (newTicker: string) => {
    // Replace the suggestion at detailSlotIndex with the new ticker
    // For now, trigger a swap via the API using the new ticker
    setSuggestions((prev) =>
      prev.map((s, i) =>
        i === detailSlotIndex ? { ...s, ticker: newTicker } : s
      )
    );
    setDetailTicker(null);
    toast.success(`Swapped in ${newTicker}`);
  };

  const totalAllocated = suggestions.reduce((sum, s) => sum + s.allocatedAmount, 0);

  const riskColor = {
    low: "text-emerald-400",
    medium: "text-amber-400",
    high: "text-red-400",
  }[config.riskLevel];

  const riskLabel = {
    low: "Conservative",
    medium: "Balanced",
    high: "Aggressive",
  }[config.riskLevel];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Your Suggestions</h1>
            <p className="text-slate-400 text-sm mt-1">Step 2 of 3 — Review & customize</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchSuggestions}
            disabled={loading}
            className="text-slate-400 hover:text-white gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Config summary */}
      <div className="glass rounded-xl px-4 py-3 flex flex-wrap gap-3 text-sm">
        <span className="text-slate-400">
          <span className="text-white font-semibold">${config.amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span> total
        </span>
        <span className="text-slate-600">·</span>
        <span className={`font-semibold ${riskColor}`}>{riskLabel}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-400">{config.stockCount} stocks</span>
        {totalAllocated > 0 && (
          <>
            <span className="text-slate-600">·</span>
            <span className="text-emerald-400 font-semibold">
              ${totalAllocated.toFixed(2)} allocated
            </span>
          </>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
          <p className="text-slate-400 text-sm">Finding the best picks for you…</p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center">
          <p className="text-red-400 mb-3">{error}</p>
          <Button variant="ghost" onClick={fetchSuggestions} className="text-slate-300">
            Try again
          </Button>
        </div>
      )}

      {/* Suggestions list */}
      {!loading && !error && (
        <div className="space-y-3">
          {suggestions.length === 0 ? (
            <div className="glass rounded-2xl p-8 text-center">
              <p className="text-slate-400 mb-2">No suggestions found</p>
              <p className="text-slate-500 text-sm mb-4">Try broadening your category filters</p>
              <Button variant="ghost" onClick={onBack} className="text-slate-300">
                Adjust settings
              </Button>
            </div>
          ) : (
            suggestions.map((s, i) => (
              <SuggestionCard
                key={s.ticker}
                item={s}
                isSwapping={swappingTicker === s.ticker}
                onSwap={() => handleSwap(s.ticker)}
                onViewDetail={() => handleViewDetail(s, i)}
              />
            ))
          )}
        </div>
      )}

      {/* Footer actions */}
      {!loading && !error && suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="glass rounded-xl px-4 py-3 flex justify-between items-center text-sm">
            <span className="text-slate-400">Total investment</span>
            <span className="font-bold text-lg">${totalAllocated.toFixed(2)}</span>
          </div>
          <Button
            onClick={() => onConfirm(suggestions)}
            className="w-full h-12 text-base font-bold bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow min-h-[44px]"
          >
            Review & Buy All
            <ChevronRight className="h-5 w-5 ml-1" />
          </Button>
        </div>
      )}

      {/* StockDetail in builder context */}
      {detailTicker && (
        <StockDetailSheet
          open={!!detailTicker}
          onClose={() => setDetailTicker(null)}
          ticker={detailTicker}
          stockName={detailName ?? undefined}
          context="builder"
          builderSlotIndex={detailSlotIndex}
          onSwapIn={handleSwapIn}
        />
      )}
    </div>
  );
}

function SuggestionCard({
  item,
  isSwapping,
  onSwap,
  onViewDetail,
}: {
  item: SuggestionItem;
  isSwapping: boolean;
  onSwap: () => void;
  onViewDetail: () => void;
}) {
  const riskColor = {
    low: "text-emerald-400",
    medium: "text-amber-400",
    high: "text-red-400",
  }[item.riskLevel] ?? "text-slate-400";

  return (
    <div
      className="glass rounded-2xl px-4 py-4 cursor-pointer hover:border-glass-border transition-colors"
      onClick={onViewDetail}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-bold text-base">{item.ticker}</span>
            <Badge className="text-xs bg-white/5 text-slate-400 hover:bg-white/5 border-0">
              {item.sector}
            </Badge>
          </div>
          <p className="text-slate-400 text-sm truncate">{item.name}</p>
          {item.description && (
            <p className="text-slate-600 text-xs mt-0.5 line-clamp-2">{item.description}</p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="font-bold text-base">${item.allocatedAmount.toFixed(2)}</p>
          <p className="text-slate-500 text-xs">{item.shares.toFixed(4)} shares</p>
          <p className="text-slate-500 text-xs">@ ${item.price.toFixed(2)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-glass-border">
        <span className={`text-xs font-medium capitalize ${riskColor}`}>
          {item.riskLevel} risk · {item.marketCap}-cap
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation(); // prevent opening detail sheet
            onSwap();
          }}
          disabled={isSwapping}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs font-medium transition-colors disabled:opacity-50 min-h-[32px] px-2 py-1 rounded-lg hover:bg-white/5"
        >
          {isSwapping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-3.5 w-3.5" />
          )}
          Swap
        </button>
      </div>
    </div>
  );
}

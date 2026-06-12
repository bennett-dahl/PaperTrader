"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export interface TradePanelProps {
  ticker: string;
  portfolioId: string;
  quote: { price: number; changePercent: number } | null;
  quoteLoading: boolean;
  onSuccess?: () => void;
}

export default function TradePanel({
  ticker,
  portfolioId,
  quote,
  quoteLoading,
  onSuccess,
}: TradePanelProps) {
  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");
  const [shares, setShares] = useState("");
  const [loading, setLoading] = useState(false);

  const sharesNum = parseFloat(shares);
  const totalCost = quote && sharesNum > 0 ? quote.price * sharesNum : null;

  const handleTrade = async () => {
    if (!sharesNum || sharesNum <= 0) {
      toast.error("Enter a valid number of shares");
      return;
    }

    if (!portfolioId) {
      toast.error("No active portfolio found");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          type: tradeType,
          shares: sharesNum,
          portfolioId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Trade failed");
        return;
      }

      toast.success(
        `${tradeType === "BUY" ? "Bought" : "Sold"} ${sharesNum} share${sharesNum !== 1 ? "s" : ""} of ${ticker} at $${data.trade.pricePerShare.toFixed(2)}`
      );
      setShares("");
      onSuccess?.();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {quoteLoading ? (
        <p className="text-slate-500 text-sm">Loading price…</p>
      ) : quote ? (
        <div className="flex items-baseline gap-2">
          <span className="tabular text-3xl font-semibold tracking-tight text-white">
            ${quote.price.toFixed(2)}
          </span>
          <span
            className={`tabular text-sm ${quote.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            {quote.changePercent >= 0 ? "+" : ""}
            {quote.changePercent.toFixed(2)}% today
          </span>
        </div>
      ) : (
        <p className="text-slate-500 text-sm">Price unavailable</p>
      )}

      <Tabs
        value={tradeType}
        onValueChange={(v) => setTradeType(v as "BUY" | "SELL")}
      >
        <TabsList className="w-full bg-white/5">
          <TabsTrigger
            value="BUY"
            className="flex-1 data-[state=active]:bg-emerald-400 data-[state=active]:text-slate-950"
          >
            Buy
          </TabsTrigger>
          <TabsTrigger
            value="SELL"
            className="flex-1 data-[state=active]:bg-red-500 data-[state=active]:text-white"
          >
            Sell
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div>
        <label className="text-slate-400 text-sm mb-1.5 block">
          Number of shares
        </label>
        <Input
          type="number"
          placeholder="0"
          min="0.0001"
          step="any"
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          className="tabular bg-white/5 border-glass-border text-white text-lg h-12"
        />
      </div>

      {totalCost !== null && (
        <div className="bg-white/5 rounded-xl px-4 py-3 flex justify-between items-center">
          <span className="text-slate-400 text-sm">Estimated total</span>
          <span className="tabular font-semibold text-lg">
            ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <Button
        onClick={handleTrade}
        disabled={loading || quoteLoading || !shares || parseFloat(shares) <= 0}
        className={`w-full h-12 text-base font-bold min-h-[44px] ${
          tradeType === "BUY"
            ? "bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow"
            : "bg-red-500 hover:bg-red-400 text-white shadow-glow-negative"
        }`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          `${tradeType === "BUY" ? "Buy" : "Sell"} ${ticker}`
        )}
      </Button>
    </div>
  );
}

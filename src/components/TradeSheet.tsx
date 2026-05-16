"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface TradeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticker: string;
  companyName: string;
}

export default function TradeSheet({
  open,
  onOpenChange,
  ticker,
  companyName,
}: TradeSheetProps) {
  const [tradeType, setTradeType] = useState<"BUY" | "SELL">("BUY");
  const [shares, setShares] = useState("");
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<{ price: number; changePercent: number } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (!open || !ticker) return;

    setQuoteLoading(true);
    fetch(`/api/quotes?tickers=${ticker}`)
      .then((r) => r.json())
      .then((data) => {
        const q = data.quotes?.[ticker];
        if (q) setQuote(q);
      })
      .catch(console.error)
      .finally(() => setQuoteLoading(false));
  }, [open, ticker]);

  const sharesNum = parseFloat(shares);
  const totalCost =
    quote && sharesNum > 0 ? quote.price * sharesNum : null;

  const handleTrade = async () => {
    if (!sharesNum || sharesNum <= 0) {
      toast.error("Enter a valid number of shares");
      return;
    }

    setLoading(true);
    try {
      // Get active portfolio ID from API
      const portfolioRes = await fetch("/api/portfolio");
      const portfolioData = await portfolioRes.json();
      const activePortfolio =
        portfolioData.portfolios?.find((p: { isDefault: boolean }) => p.isDefault) ??
        portfolioData.portfolios?.[0];

      if (!activePortfolio) {
        toast.error("No active portfolio found");
        return;
      }

      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          type: tradeType,
          shares: sharesNum,
          portfolioId: activePortfolio.id,
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
      onOpenChange(false);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-slate-900 border-slate-700 rounded-t-3xl pb-8">
        <SheetHeader className="text-left mb-6">
          <SheetTitle className="text-white text-xl">
            {ticker}{" "}
            <span className="text-slate-400 font-normal text-base">
              {companyName}
            </span>
          </SheetTitle>
          {quoteLoading ? (
            <p className="text-slate-500 text-sm">Loading price…</p>
          ) : quote ? (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">
                ${quote.price.toFixed(2)}
              </span>
              <span
                className={`text-sm ${quote.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {quote.changePercent >= 0 ? "+" : ""}
                {quote.changePercent.toFixed(2)}% today
              </span>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">Price unavailable</p>
          )}
        </SheetHeader>

        <div className="space-y-4">
          <Tabs
            value={tradeType}
            onValueChange={(v) => setTradeType(v as "BUY" | "SELL")}
          >
            <TabsList className="w-full bg-slate-800">
              <TabsTrigger
                value="BUY"
                className="flex-1 data-[state=active]:bg-emerald-500 data-[state=active]:text-slate-900"
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
              className="bg-slate-800 border-slate-700 text-white text-lg h-12"
            />
          </div>

          {totalCost !== null && (
            <div className="bg-slate-800 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-slate-400 text-sm">Estimated total</span>
              <span className="font-bold text-lg">
                ${totalCost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          <Button
            onClick={handleTrade}
            disabled={loading || !shares || parseFloat(shares) <= 0}
            className={`w-full h-12 text-base font-bold min-h-[44px] ${
              tradeType === "BUY"
                ? "bg-emerald-500 hover:bg-emerald-400 text-slate-900"
                : "bg-red-500 hover:bg-red-400 text-white"
            }`}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `${tradeType === "BUY" ? "Buy" : "Sell"} ${ticker}`
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

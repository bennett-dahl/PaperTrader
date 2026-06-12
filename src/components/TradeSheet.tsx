"use client";

import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import TradePanel from "@/components/TradePanel";
import { useActivePortfolio } from "@/contexts/ActivePortfolioContext";

interface TradeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticker: string;
  companyName: string;
  /** If omitted, falls back to context activePortfolioId */
  portfolioId?: string;
}

export default function TradeSheet({
  open,
  onOpenChange,
  ticker,
  companyName,
  portfolioId: portfolioIdProp,
}: TradeSheetProps) {
  const { activePortfolioId } = useActivePortfolio();
  const portfolioId = portfolioIdProp ?? activePortfolioId ?? "";

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="bg-popover backdrop-blur-xl border-glass-border rounded-t-3xl pb-8">
        <SheetHeader className="text-left mb-6">
          <SheetTitle className="text-white text-xl">
            {ticker}{" "}
            <span className="text-slate-400 font-normal text-base">
              {companyName}
            </span>
          </SheetTitle>
        </SheetHeader>

        <TradePanel
          ticker={ticker}
          portfolioId={portfolioId}
          quote={quote}
          quoteLoading={quoteLoading}
          onSuccess={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

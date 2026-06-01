"use client";

import { useState } from "react";
import Link from "next/link";
import StockSearch from "@/components/StockSearch";
import { StockDetailSheet } from "@/components/stock-detail/StockDetailSheet";
import { Wand2 } from "lucide-react";

interface SelectedStock {
  ticker: string;
  name: string;
}

export default function TradePage() {
  const [selectedStock, setSelectedStock] = useState<SelectedStock | null>(null);

  const handleSelectStock = (stock: SelectedStock) => {
    setSelectedStock(stock);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trade</h1>
        <p className="text-slate-400 text-sm mt-1">
          Search for a stock to buy or sell
        </p>
      </div>

      <StockSearch onSelect={handleSelectStock} />

      {/* Portfolio Builder CTA */}
      <Link
        href="/advisor"
        className="flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-emerald-400/5 border border-emerald-500/30 rounded-2xl px-5 py-4 hover:border-emerald-400/50 transition-colors group"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Wand2 className="h-4 w-4 text-emerald-400" />
            <p className="font-semibold text-sm text-emerald-300">Stock Advisor</p>
          </div>
          <p className="text-slate-400 text-xs">
            Get personalized stock picks for your portfolio in 3 easy steps
          </p>
        </div>
        <div className="text-emerald-400 text-xl group-hover:translate-x-1 transition-transform">→</div>
      </Link>

      {/* Quick picks */}
      <div>
        <h2 className="text-sm font-medium text-slate-400 mb-3">
          Popular stocks
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { ticker: "AAPL", name: "Apple Inc." },
            { ticker: "TSLA", name: "Tesla, Inc." },
            { ticker: "NVDA", name: "NVIDIA Corp." },
            { ticker: "MSFT", name: "Microsoft Corp." },
            { ticker: "GOOGL", name: "Alphabet Inc." },
            { ticker: "SPY", name: "S&P 500 ETF" },
          ].map((stock) => (
            <button
              key={stock.ticker}
              onClick={() => handleSelectStock(stock)}
              className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-left hover:border-slate-600 transition-colors min-h-[44px]"
            >
              <div>
                <p className="font-semibold text-sm">{stock.ticker}</p>
                <p className="text-slate-500 text-xs truncate">{stock.name}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedStock && (
        <StockDetailSheet
          open={!!selectedStock}
          onClose={() => setSelectedStock(null)}
          ticker={selectedStock.ticker}
          stockName={selectedStock.name}
          context="search"
        />
      )}
    </div>
  );
}

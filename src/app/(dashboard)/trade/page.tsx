"use client";

import { useState } from "react";
import StockSearch from "@/components/StockSearch";
import TradeSheet from "@/components/TradeSheet";

interface SelectedStock {
  ticker: string;
  name: string;
  price?: number;
}

export default function TradePage() {
  const [selectedStock, setSelectedStock] = useState<SelectedStock | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleSelectStock = (stock: SelectedStock) => {
    setSelectedStock(stock);
    setSheetOpen(true);
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
        <TradeSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          ticker={selectedStock.ticker}
          companyName={selectedStock.name}
        />
      )}
    </div>
  );
}

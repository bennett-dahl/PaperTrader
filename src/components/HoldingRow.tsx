import { Holding, CachedQuote } from "@/db/schema";
import { TrendingUp, TrendingDown } from "lucide-react";

interface HoldingRowProps {
  holding: Holding;
  quote?: CachedQuote;
}

export default function HoldingRow({ holding, quote }: HoldingRowProps) {
  const shares = parseFloat(holding.shares);
  const avgCost = parseFloat(holding.avgCostBasis);
  const currentPrice = quote ? parseFloat(quote.price) : avgCost;
  const currentValue = shares * currentPrice;
  const costBasis = shares * avgCost;
  const gainLoss = currentValue - costBasis;
  const gainLossPct = costBasis > 0 ? (gainLoss / costBasis) * 100 : 0;
  const isUp = gainLoss >= 0;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-bold text-lg">{holding.ticker}</p>
          <p className="text-slate-500 text-xs mt-0.5">
            {shares.toFixed(shares % 1 === 0 ? 0 : 4)} shares · avg ${avgCost.toFixed(2)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold">
            ${currentValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          {quote && (
            <p className="text-slate-400 text-xs mt-0.5">
              ${currentPrice.toFixed(2)}/share
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-800">
        <div className="flex items-center gap-1.5">
          {isUp ? (
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5 text-red-400" />
          )}
          <span
            className={`text-sm font-semibold ${isUp ? "text-emerald-400" : "text-red-400"}`}
          >
            {isUp ? "+" : ""}${gainLoss.toFixed(2)} ({isUp ? "+" : ""}
            {gainLossPct.toFixed(2)}%)
          </span>
        </div>
        {quote && (
          <span
            className={`text-xs ${parseFloat(quote.changePercent) >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            Today: {parseFloat(quote.changePercent) >= 0 ? "+" : ""}
            {parseFloat(quote.changePercent).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

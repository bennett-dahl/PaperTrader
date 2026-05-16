interface PortfolioCardProps {
  totalValue: number;
  cashBalance: number;
  holdingsValue: number;
  totalReturn: number;
  totalReturnPct: number;
}

export default function PortfolioCard({
  totalValue,
  cashBalance,
  holdingsValue,
  totalReturn,
  totalReturnPct,
}: PortfolioCardProps) {
  const isUp = totalReturn >= 0;

  return (
    <div className="bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 rounded-2xl p-5 space-y-4">
      {/* Total value */}
      <div>
        <p className="text-slate-400 text-sm">Total Portfolio Value</p>
        <p className="text-4xl font-extrabold mt-1">
          ${totalValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span
            className={`text-sm font-semibold px-2 py-0.5 rounded-full ${
              isUp
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {isUp ? "+" : ""}
            {totalReturnPct.toFixed(2)}%
          </span>
          <span className={`text-sm ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {isUp ? "+" : ""}${totalReturn.toFixed(2)} all time
          </span>
        </div>
      </div>

      {/* Breakdown */}
      <div className="flex gap-4 pt-2 border-t border-slate-700">
        <div className="flex-1">
          <p className="text-slate-500 text-xs">Cash</p>
          <p className="font-semibold text-sm mt-0.5">
            ${cashBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex-1">
          <p className="text-slate-500 text-xs">Invested</p>
          <p className="font-semibold text-sm mt-0.5">
            ${holdingsValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
      </div>
    </div>
  );
}

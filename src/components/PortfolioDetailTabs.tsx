"use client";

import { useState } from "react";
import { Portfolio } from "@/db/schema";
import { HoldingWithPrice } from "@/types";
import LivePortfolioDashboard from "@/components/LivePortfolioDashboard";
import PortfolioHistoryTab from "@/components/PortfolioHistoryTab";

type Tab = "holdings" | "history";

interface Props {
  portfolio: Portfolio;
  initialHoldings: HoldingWithPrice[];
  initialCashBalance: number;
  initialTotalValue: number;
  startingBalance: number;
}

export default function PortfolioDetailTabs({ portfolio, initialHoldings, initialCashBalance, initialTotalValue, startingBalance }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("holdings");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{portfolio.name}</h1>
        <p className="text-slate-400 text-sm mt-1">
          Cash: $
          {parseFloat(portfolio.cashBalance).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-slate-800/50 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("holdings")}
          data-testid="tab-holdings"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "holdings"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Holdings
        </button>
        <button
          onClick={() => setActiveTab("history")}
          data-testid="tab-history"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          History
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "holdings" && (
        <LivePortfolioDashboard
          portfolioId={portfolio.id}
          initialHoldings={initialHoldings}
          initialCashBalance={initialCashBalance}
          initialTotalValue={initialTotalValue}
          startingBalance={startingBalance}
        />
      )}
      {activeTab === "history" && (
        <PortfolioHistoryTab portfolioId={portfolio.id} />
      )}
    </div>
  );
}

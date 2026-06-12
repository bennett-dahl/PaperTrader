"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  ShoppingCart,
  LayoutDashboard,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { SuggestionItem, BuildConfig } from "./PortfolioBuilderWizard";

interface ExecuteResult {
  ticker: string;
  success: boolean;
  error?: string;
  totalAmount?: number;
}

interface Step3ConfirmProps {
  config: BuildConfig;
  suggestions: SuggestionItem[];
  executeResults: {
    results: ExecuteResult[];
    successCount: number;
    failCount: number;
  } | null;
  onBack: () => void;
  onExecute: (results: {
    results: ExecuteResult[];
    successCount: number;
    failCount: number;
  }) => void;
  onReset: () => void;
}

export default function Step3Confirm({
  config,
  suggestions,
  executeResults,
  onBack,
  onExecute,
  onReset,
}: Step3ConfirmProps) {
  const [executing, setExecuting] = useState(false);
  const router = useRouter();

  const totalAmount = suggestions.reduce((sum, s) => sum + s.allocatedAmount, 0);

  const handleBuyAll = async () => {
    setExecuting(true);
    try {
      const res = await fetch("/api/suggest/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioId: config.portfolioId,
          allocations: suggestions.map((s) => ({
            ticker: s.ticker,
            shares: s.shares,
            price: s.price,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Execution failed");
        return;
      }

      onExecute(data);

      if (data.failCount === 0) {
        toast.success(`🎉 Bought ${data.successCount} stocks successfully!`);
      } else if (data.successCount > 0) {
        toast.warning(
          `Bought ${data.successCount} of ${data.totalTrades} stocks. ${data.failCount} failed.`
        );
      } else {
        toast.error("All trades failed. Check the details below.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setExecuting(false);
    }
  };

  // Show results view after execution
  if (executeResults) {
    const allSuccess = executeResults.failCount === 0;
    const partialSuccess = executeResults.successCount > 0 && executeResults.failCount > 0;
    const allFailed = executeResults.successCount === 0;

    return (
      <div className="space-y-6">
        {/* Result header */}
        <div className="text-center py-4">
          {allSuccess && (
            <div>
              <CheckCircle2 className="h-16 w-16 text-emerald-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold">Portfolio Built! 🎉</h1>
              <p className="text-slate-400 text-sm mt-1">
                All {executeResults.successCount} trades executed successfully
              </p>
            </div>
          )}
          {partialSuccess && (
            <div>
              <div className="h-16 w-16 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">⚠️</span>
              </div>
              <h1 className="text-2xl font-bold">Partial Success</h1>
              <p className="text-slate-400 text-sm mt-1">
                {executeResults.successCount} of {executeResults.successCount + executeResults.failCount} trades succeeded
              </p>
            </div>
          )}
          {allFailed && (
            <div>
              <XCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold">Trades Failed</h1>
              <p className="text-slate-400 text-sm mt-1">
                No trades were executed
              </p>
            </div>
          )}
        </div>

        {/* Result breakdown */}
        <div className="space-y-2">
          {executeResults.results.map((r) => (
            <div
              key={r.ticker}
              className="flex items-center justify-between glass rounded-xl px-4 py-3"
            >
              <div className="flex items-center gap-3">
                {r.success ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                )}
                <div>
                  <p className="font-semibold text-sm">{r.ticker}</p>
                  {r.error && <p className="text-red-400 text-xs">{r.error}</p>}
                </div>
              </div>
              {r.success && r.totalAmount !== undefined && (
                <span className="text-red-400 font-medium text-sm">
                  -${r.totalAmount.toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            onClick={() => router.push("/dashboard")}
            className="w-full h-12 text-base font-bold bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow min-h-[44px]"
          >
            <LayoutDashboard className="h-5 w-5 mr-2" />
            View Portfolio
          </Button>
          <Button
            variant="ghost"
            onClick={onReset}
            className="w-full text-slate-400 hover:text-white min-h-[44px]"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Build Another
          </Button>
        </div>
      </div>
    );
  }

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
        <h1 className="text-2xl font-bold">Confirm & Buy</h1>
        <p className="text-slate-400 text-sm mt-1">Step 3 of 3 — Review and execute all trades</p>
      </div>

      {/* Warning */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm text-amber-300">
        💡 Prices are approximate. Actual fills may differ slightly due to market movement.
      </div>

      {/* Trade list */}
      <div className="space-y-2">
        {suggestions.map((s) => (
          <div
            key={s.ticker}
            className="flex items-center justify-between glass rounded-xl px-4 py-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold">{s.ticker}</span>
                <Badge className="text-xs bg-white/5 text-slate-500 hover:bg-white/5 border-0">
                  {s.sector}
                </Badge>
              </div>
              <p className="text-slate-500 text-xs mt-0.5">
                {s.shares.toFixed(4)} shares @ ${s.price.toFixed(2)}
              </p>
            </div>
            <span className="font-semibold text-red-400">
              -${s.allocatedAmount.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="glass rounded-2xl p-4">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Total cost</span>
          <span className="text-2xl font-bold text-red-400">-${totalAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center mt-2 text-sm text-slate-500">
          <span>{suggestions.length} trades</span>
          <span>~${(totalAmount / suggestions.length).toFixed(2)} each</span>
        </div>
      </div>

      <Button
        onClick={handleBuyAll}
        disabled={executing}
        className="w-full h-12 text-base font-bold bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow min-h-[44px]"
      >
        {executing ? (
          <>
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Buying…
          </>
        ) : (
          <>
            <ShoppingCart className="h-5 w-5 mr-2" />
            Buy All {suggestions.length} Stocks
          </>
        )}
      </Button>
    </div>
  );
}

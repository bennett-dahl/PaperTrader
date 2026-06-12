"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, DollarSign, Sparkles } from "lucide-react";
import { toast } from "sonner";

const SUGGESTED_STOCKS = [
  { ticker: "AAPL", name: "Apple Inc.", desc: "Consumer tech giant, consistent dividend payer" },
  { ticker: "TSLA", name: "Tesla, Inc.", desc: "High-volatility EV & energy play" },
  { ticker: "SPY", name: "S&P 500 ETF", desc: "Passive index fund, low risk diversification" },
  { ticker: "NVDA", name: "NVIDIA Corp.", desc: "AI chip leader, high growth potential" },
  { ticker: "MSFT", name: "Microsoft Corp.", desc: "Cloud & software powerhouse" },
];

interface OnboardingFlowProps {
  userId: string;
  userName: string;
}

export default function OnboardingFlow({ userId, userName }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [portfolioName, setPortfolioName] = useState("My First Portfolio");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: portfolioName || "My First Portfolio" }),
      });

      if (!res.ok) {
        toast.error("Failed to create portfolio. Please try again.");
        return;
      }

      toast.success("Portfolio created! Let's start trading.");
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen text-foreground flex items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">
        {step === 0 && (
          <div className="text-center space-y-6">
            <div className="flex items-center justify-center">
              <div className="bg-emerald-500/10 p-4 rounded-2xl">
                <TrendingUp className="h-10 w-10 text-emerald-400" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-extrabold">
                Welcome, {userName.split(" ")[0]}! 👋
              </h1>
              <p className="text-slate-400 mt-3 leading-relaxed">
                You're about to start your paper trading journey.
                No real money — just skills.
              </p>
            </div>
            <Button
              onClick={() => setStep(1)}
              className="w-full h-12 bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow font-bold text-base"
            >
              Let's go →
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="flex items-center justify-center mb-4">
                <div className="bg-yellow-500/10 p-4 rounded-2xl">
                  <DollarSign className="h-10 w-10 text-yellow-400" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold">You have $5,000</h2>
              <p className="text-slate-400 mt-2 leading-relaxed text-sm">
                Every portfolio starts with $5,000 in virtual cash. You can't
                lose real money here — but you can absolutely learn what it
                feels like to.
              </p>
            </div>

            <div className="glass rounded-2xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Starting cash</span>
                <span className="font-bold text-emerald-400">$5,000.00</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Real money involved</span>
                <span className="font-bold">$0.00 🎉</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Risk of loss</span>
                <span className="font-bold">None</span>
              </div>
            </div>

            <Button
              onClick={() => setStep(2)}
              className="w-full h-12 bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow font-bold text-base"
            >
              Got it! →
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="flex items-center justify-center mb-4">
                <div className="bg-purple-500/10 p-4 rounded-2xl">
                  <Sparkles className="h-10 w-10 text-purple-400" />
                </div>
              </div>
              <h2 className="text-2xl font-extrabold">Popular first picks</h2>
              <p className="text-slate-400 mt-2 text-sm">
                Once you're in, you can buy any of these or search for any stock.
              </p>
            </div>

            <div className="space-y-2">
              {SUGGESTED_STOCKS.map((stock) => (
                <div
                  key={stock.ticker}
                  className="glass rounded-xl px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-semibold">{stock.ticker}</p>
                    <p className="text-slate-500 text-xs">{stock.desc}</p>
                  </div>
                  <span className="text-slate-600 text-xs">{stock.name.split(" ")[0]}</span>
                </div>
              ))}
            </div>

            <Button
              onClick={() => setStep(3)}
              className="w-full h-12 bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow font-bold text-base"
            >
              Create my portfolio →
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-2xl font-extrabold">Name your portfolio</h2>
              <p className="text-slate-400 mt-2 text-sm">
                You can create multiple portfolios later to test different strategies.
              </p>
            </div>

            <div>
              <Input
                type="text"
                value={portfolioName}
                onChange={(e) => setPortfolioName(e.target.value)}
                placeholder="My First Portfolio"
                className="bg-popover backdrop-blur-xl border-glass-border text-white h-12 text-center text-lg font-semibold"
              />
            </div>

            <Button
              onClick={handleCreate}
              disabled={loading || !portfolioName.trim()}
              className="w-full h-12 bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow font-bold text-base"
            >
              {loading ? "Creating…" : "Start trading! 🚀"}
            </Button>
          </div>
        )}

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          {[0, 1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                s === step ? "w-6 bg-emerald-400" : "w-1.5 bg-white/10"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

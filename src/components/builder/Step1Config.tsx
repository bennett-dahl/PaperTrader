"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Wand2, BookOpen, ChevronRight } from "lucide-react";
import type { BuildConfig } from "./PortfolioBuilderWizard";
import PresetsPanel from "./PresetsPanel";

const CATEGORIES = [
  { id: "tech",          label: "Technology" },
  { id: "finance",       label: "Finance" },
  { id: "healthcare",    label: "Healthcare" },
  { id: "energy",        label: "Energy" },
  { id: "consumer",      label: "Consumer" },
  { id: "etf",           label: "ETFs" },
  { id: "bond",          label: "Bonds" },
  { id: "international", label: "International" },
  { id: "realestate",    label: "Real Estate" },
  { id: "dividend",      label: "Dividend" },
  { id: "crypto",        label: "Crypto-adjacent" },
  { id: "biotech",       label: "Biotech" },
  { id: "fintech",       label: "Fintech" },
  { id: "ev",            label: "Electric Vehicles" },
];

const RISK_LEVELS = [
  {
    value: "low" as const,
    label: "Conservative",
    emoji: "🛡️",
    description: "Low-risk ETFs, bonds & blue chips",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
    activeBg: "bg-emerald-500/20 border-emerald-500",
  },
  {
    value: "medium" as const,
    label: "Balanced",
    emoji: "⚖️",
    description: "Mix of growth & stability",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
    activeBg: "bg-amber-500/20 border-amber-500",
  },
  {
    value: "high" as const,
    label: "Aggressive",
    emoji: "🚀",
    description: "High-growth & speculative plays",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    activeBg: "bg-red-500/20 border-red-500",
  },
];

interface Step1ConfigProps {
  portfolios: { id: string; name: string; cashBalance: number; isDefault: boolean }[];
  initialConfig: BuildConfig;
  onSubmit: (config: BuildConfig) => void;
}

export default function Step1Config({ portfolios, initialConfig, onSubmit }: Step1ConfigProps) {
  const [portfolioId, setPortfolioId] = useState(initialConfig.portfolioId);
  const [amount, setAmount] = useState(initialConfig.amount);
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high">(initialConfig.riskLevel);
  const [categories, setCategories] = useState<string[]>(initialConfig.categories);
  const [stockCount, setStockCount] = useState(initialConfig.stockCount);
  const [showPresets, setShowPresets] = useState(false);

  const activePortfolio = portfolios.find((p) => p.id === portfolioId) ?? portfolios[0];
  const maxAmount = activePortfolio?.cashBalance ?? 0;

  // Clamp amount when portfolio changes
  useEffect(() => {
    if (amount > maxAmount) setAmount(maxAmount);
  }, [portfolioId, maxAmount, amount]);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleApplyPreset = (preset: {
    riskLevel: "low" | "medium" | "high";
    investAmount: string;
    categories: string[];
    stockCount: number;
  }) => {
    setRiskLevel(preset.riskLevel);
    const amt = Math.min(parseFloat(preset.investAmount), maxAmount);
    setAmount(amt);
    setCategories(preset.categories);
    setStockCount(preset.stockCount);
    setShowPresets(false);
  };

  const handleSubmit = () => {
    if (!portfolioId || amount <= 0) return;
    onSubmit({ portfolioId, amount, riskLevel, categories, stockCount });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wand2 className="h-6 w-6 text-emerald-400" />
            Build a Portfolio
          </h1>
          <p className="text-slate-400 text-sm mt-1">Step 1 of 3 — Configure your strategy</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowPresets(!showPresets)}
          className="text-slate-400 hover:text-white gap-1.5"
        >
          <BookOpen className="h-4 w-4" />
          Presets
        </Button>
      </div>

      {/* Presets panel */}
      {showPresets && (
        <PresetsPanel onApply={handleApplyPreset} onClose={() => setShowPresets(false)} currentConfig={{ riskLevel, investAmount: amount, categories, stockCount }} />
      )}

      {/* Portfolio selector */}
      {portfolios.length > 1 && (
        <div>
          <label className="text-slate-400 text-sm mb-1.5 block">Portfolio</label>
          <Select value={portfolioId} onValueChange={(v) => { if (v) setPortfolioId(v); }}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
              <SelectValue>{portfolios.find((p) => p.id === portfolioId)?.name ?? "Portfolio"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {portfolios.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} (${p.cashBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })} available)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Amount slider */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <label className="text-slate-400 text-sm">Invest amount</label>
          <span className="text-2xl font-bold text-white">
            ${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </span>
        </div>
        <Slider
          min={100}
          max={Math.max(maxAmount, 100)}
          step={50}
          value={[amount]}
          onValueChange={(v) => { const val = Array.isArray(v) ? v[0] : v; setAmount(val as number); }}
          className="mb-2"
          disabled={maxAmount <= 0}
        />
        <div className="flex justify-between text-xs text-slate-600">
          <span>$100</span>
          <span className="text-slate-500">
            Available: ${maxAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span>
          <span>${maxAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
        </div>
      </div>

      {/* Risk level */}
      <div>
        <label className="text-slate-400 text-sm mb-3 block">Risk level</label>
        <div className="grid grid-cols-3 gap-2">
          {RISK_LEVELS.map((r) => (
            <button
              key={r.value}
              onClick={() => setRiskLevel(r.value)}
              className={`flex flex-col items-center p-4 rounded-2xl border transition-colors text-center min-h-[44px] ${
                riskLevel === r.value ? r.activeBg : r.bg
              }`}
            >
              <span className="text-2xl mb-1">{r.emoji}</span>
              <p className={`text-sm font-semibold ${r.color}`}>{r.label}</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-tight">{r.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Stock count */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <label className="text-slate-400 text-sm">Number of stocks</label>
          <span className="text-xl font-bold text-white">{stockCount}</span>
        </div>
        <Slider
          min={2}
          max={15}
          step={1}
          value={[stockCount]}
          onValueChange={(v) => { const val = Array.isArray(v) ? v[0] : v; setStockCount(val as number); }}
          className="mb-2"
        />
        <div className="flex justify-between text-xs text-slate-600">
          <span>2</span>
          <span>15</span>
        </div>
      </div>

      {/* Category filters */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-slate-400 text-sm">Categories <span className="text-slate-600">(optional)</span></label>
          {categories.length > 0 && (
            <button
              onClick={() => setCategories([])}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => toggleCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors min-h-[32px] ${
                categories.includes(cat.id)
                  ? "bg-emerald-500/20 border-emerald-500 text-emerald-300"
                  : "bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        {categories.length > 0 && (
          <p className="text-xs text-slate-500 mt-2">
            Filtering to: {categories.map((c) => CATEGORIES.find((x) => x.id === c)?.label ?? c).join(", ")}
          </p>
        )}
      </div>

      {/* Summary */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
        <p className="text-sm font-medium text-slate-300">Summary</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-slate-500">Portfolio</p>
            <p className="font-medium">{activePortfolio?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-slate-500">Amount</p>
            <p className="font-medium">${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
          </div>
          <div>
            <p className="text-slate-500">Strategy</p>
            <p className="font-medium capitalize">{riskLevel}</p>
          </div>
          <div>
            <p className="text-slate-500">Stocks</p>
            <p className="font-medium">{stockCount}</p>
          </div>
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!portfolioId || amount <= 0 || maxAmount <= 0}
        className="w-full h-12 text-base font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-900 min-h-[44px]"
      >
        Get Suggestions
        <ChevronRight className="h-5 w-5 ml-1" />
      </Button>
    </div>
  );
}

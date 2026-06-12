"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StrategyTemplate, Portfolio } from "@/db/schema";

const DEFAULT_CONFIG = {
  strategyType: "thesis_driven",
  maxPositions: 10,
  maxPositionPct: 10,
  minCashReservePct: 5,
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: 0.65,
  autonomous: true,
  rebalanceOnRun: false,
};

export default function NewPipelinePage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [thesis, setThesis] = useState("");
  const [strategyType, setStrategyType] = useState("thesis_driven");
  const [tickerUniverse, setTickerUniverse] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [selectedPortfolios, setSelectedPortfolios] = useState<Record<string, number>>({});

  useEffect(() => {
    Promise.all([
      fetch("/api/strategy-templates").then((r) => r.json()),
      fetch("/api/portfolio").then((r) => r.json()),
    ]).then(([templatesData, portfoliosData]) => {
      setTemplates(templatesData.templates ?? []);
      setPortfolios(portfoliosData.portfolios ?? []);
      setLoading(false);
    });
  }, []);

  function applyTemplate(id: string) {
    const t = templates.find((t) => t.id === id);
    if (!t) return;
    setThesis(t.thesis);
    setStrategyType(t.strategyType);
    setTickerUniverse(t.tickerUniverse);
    setConfig({
      strategyType: t.strategyType,
      maxPositions: t.maxPositions,
      maxPositionPct: parseFloat(t.maxPositionPct),
      minCashReservePct: parseFloat(t.minCashReservePct),
      earningsLookbackDays: t.earningsLookbackDays,
      earningsForwardDays: t.earningsForwardDays,
      minConfidenceThreshold: parseFloat(t.minConfidenceThreshold),
      autonomous: t.autonomous,
      rebalanceOnRun: t.rebalanceOnRun,
    });
  }

  function addTicker() {
    const t = tickerInput.trim().toUpperCase();
    if (t && !tickerUniverse.includes(t)) {
      setTickerUniverse([...tickerUniverse, t]);
    }
    setTickerInput("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !thesis) { setError("Name and thesis are required"); return; }
    setSaving(true);
    setError(null);

    const portfolioAssignments = Object.entries(selectedPortfolios).map(([portfolioId, allocationPct]) => ({
      portfolioId,
      allocationPct,
    }));

    const res = await fetch("/api/pipelines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        templateId: templateId || undefined,
        thesis,
        tickerUniverse,
        ...config,
        portfolioAssignments,
      }),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Failed to create pipeline");
      setSaving(false);
      return;
    }

    const { pipeline } = await res.json();
    router.push(`/pipelines/${pipeline.id}`);
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-white/5 rounded w-1/3" />
          <div className="h-32 bg-white/5 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">New Pipeline</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Strategy Template */}
        <div className="glass rounded-xl p-6">
          <h2 className="font-semibold text-slate-100 mb-4">Strategy Template (optional)</h2>
          <select
            value={templateId}
            onChange={(e) => { setTemplateId(e.target.value); if (e.target.value) applyTemplate(e.target.value); }}
            className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">— No template (standalone) —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Basic */}
        <div className="glass rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-slate-100">Basic</h2>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Pipeline Name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Earnings Momentum Q3"
              className="w-full glass rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Strategy Type</label>
            <select
              value={strategyType}
              onChange={(e) => setStrategyType(e.target.value)}
              className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="thesis_driven">Thesis Driven</option>
              <option value="signal_driven">Signal Driven</option>
            </select>
          </div>
        </div>

        {/* Thesis */}
        <div className="glass rounded-xl p-6">
          <h2 className="font-semibold text-slate-100 mb-4">Investment Thesis *</h2>
          <textarea
            required
            rows={5}
            value={thesis}
            onChange={(e) => setThesis(e.target.value)}
            placeholder="Describe the investment thesis. E.g. 'Buy tech stocks that beat earnings by >5% and have positive analyst revisions. Sell positions that miss earnings or get downgraded.'"
            className="w-full glass rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        {/* Ticker Universe */}
        <div className="glass rounded-xl p-6">
          <h2 className="font-semibold text-slate-100 mb-1">Ticker Universe</h2>
          <p className="text-sm text-slate-400 mb-3">Leave empty to let the AI choose from the full stock universe.</p>
          <div className="flex gap-2 mb-3">
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTicker(); } }}
              placeholder="AAPL"
              className="flex-1 glass rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={addTicker}
              className="px-4 py-2 bg-white/10 hover:bg-slate-600 text-slate-100 rounded-lg"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tickerUniverse.map((t) => (
              <span key={t} className="flex items-center gap-1 px-2 py-1 bg-white/10 text-slate-200 text-sm rounded-lg">
                {t}
                <button type="button" onClick={() => setTickerUniverse(tickerUniverse.filter((x) => x !== t))} className="text-slate-400 hover:text-red-400">✕</button>
              </span>
            ))}
          </div>
        </div>

        {/* Execution Levers */}
        <div className="glass rounded-xl p-6">
          <h2 className="font-semibold text-slate-100 mb-4">Execution Config</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Positions</label>
              <input type="number" min={1} value={config.maxPositions}
                onChange={(e) => setConfig({ ...config, maxPositions: parseInt(e.target.value) })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Position % of Portfolio</label>
              <input type="number" min={1} max={100} step={0.5} value={config.maxPositionPct}
                onChange={(e) => setConfig({ ...config, maxPositionPct: parseFloat(e.target.value) })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Min Cash Reserve %</label>
              <input type="number" min={0} max={100} step={0.5} value={config.minCashReservePct}
                onChange={(e) => setConfig({ ...config, minCashReservePct: parseFloat(e.target.value) })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Min Confidence Threshold</label>
              <input type="number" min={0} max={1} step={0.05} value={config.minConfidenceThreshold}
                onChange={(e) => setConfig({ ...config, minConfidenceThreshold: parseFloat(e.target.value) })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Earnings Lookback Days</label>
              <input type="number" min={1} value={config.earningsLookbackDays}
                onChange={(e) => setConfig({ ...config, earningsLookbackDays: parseInt(e.target.value) })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Earnings Forward Days</label>
              <input type="number" min={1} value={config.earningsForwardDays}
                onChange={(e) => setConfig({ ...config, earningsForwardDays: parseInt(e.target.value) })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>
          <div className="mt-4 flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={config.autonomous}
                onChange={(e) => setConfig({ ...config, autonomous: e.target.checked })}
                className="rounded" />
              <span className="text-sm text-slate-300">Autonomous (execute trades)</span>
            </label>
          </div>
        </div>

        {/* Portfolios */}
        {portfolios.length > 0 && (
          <div className="glass rounded-xl p-6">
            <h2 className="font-semibold text-slate-100 mb-4">Assign Portfolios</h2>
            <div className="space-y-3">
              {portfolios.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id={`portfolio-${p.id}`}
                    checked={p.id in selectedPortfolios}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPortfolios({ ...selectedPortfolios, [p.id]: 100 });
                      } else {
                        const { [p.id]: _, ...rest } = selectedPortfolios;
                        setSelectedPortfolios(rest);
                      }
                    }}
                    className="rounded"
                  />
                  <label htmlFor={`portfolio-${p.id}`} className="flex-1 text-sm text-slate-300 cursor-pointer">
                    {p.name}
                  </label>
                  {p.id in selectedPortfolios && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1} max={100}
                        value={selectedPortfolios[p.id]}
                        onChange={(e) => setSelectedPortfolios({ ...selectedPortfolios, [p.id]: parseInt(e.target.value) })}
                        className="w-16 glass rounded px-2 py-1 text-slate-100 text-sm focus:outline-none"
                      />
                      <span className="text-xs text-slate-400">%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium"
          >
            {saving ? "Creating..." : "Create Pipeline"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 bg-white/10 hover:bg-slate-600 text-slate-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

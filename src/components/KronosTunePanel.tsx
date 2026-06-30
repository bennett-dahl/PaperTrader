"use client";

import { useState, useEffect } from "react";
import { Save, RotateCcw } from "lucide-react";
import { computeKronosTradePct, generateCurvePoints, type SizingCurve } from "@/lib/kronos-sizing";

interface KronosTuneConfig {
  kronosMinSignalPct: string;
  kronosMinTradePct: string;
  kronosMaxTradePct: string;
  kronosSaturationPct: string;
  kronosSizingCurve: SizingCurve;
  kronosTickerUniverse: string[];
  maxPositions: number;
  maxPositionPct: string;
  minCashReservePct: string;
  minConfidenceThreshold: string;
  earningsLookbackDays: number;
  earningsForwardDays: number;
}

interface KronosTunePanelProps {
  pipelineId: string;
  initial: KronosTuneConfig;
  onSaved: () => void;  // refresh parent data
}

export function KronosTunePanel({ pipelineId, initial, onSaved }: KronosTunePanelProps) {
  const [config, setConfig] = useState<KronosTuneConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tickerInput, setTickerInput] = useState("");

  // Reset dirty flag when initial changes (e.g. after save)
  useEffect(() => {
    setConfig(initial);
    setDirty(false);
  }, [initial]);

  function update<K extends keyof KronosTuneConfig>(key: K, value: KronosTuneConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function reset() {
    setConfig(initial);
    setDirty(false);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch(`/api/pipelines/${pipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setSaveError(d.error ?? "Save failed");
    } else {
      setDirty(false);
      onSaved();
    }
    setSaving(false);
  }

  // Live curve points for the preview
  const sizingConfig = {
    kronosMinSignalPct:  parseFloat(config.kronosMinSignalPct  || "1"),
    kronosMinTradePct:   parseFloat(config.kronosMinTradePct   || "20"),
    kronosMaxTradePct:   parseFloat(config.kronosMaxTradePct   || "80"),
    kronosSaturationPct: parseFloat(config.kronosSaturationPct || "5"),
    kronosSizingCurve:   config.kronosSizingCurve,
  };
  const curvePoints = generateCurvePoints(sizingConfig, 60);

  // Example signals for the "what would happen" preview
  const exampleSignals = [1, 2, 3, 4, 5, 7, 10];

  function addTicker(t: string) {
    const upper = t.toUpperCase().trim();
    if (!upper || config.kronosTickerUniverse.includes(upper)) return;
    update("kronosTickerUniverse", [...config.kronosTickerUniverse, upper]);
    setTickerInput("");
  }

  function removeTicker(t: string) {
    update("kronosTickerUniverse", config.kronosTickerUniverse.filter((x) => x !== t));
  }

  return (
    <div className="space-y-8">
      {/* Sticky save bar */}
      {dirty && (
        <div className="sticky top-4 z-10 flex items-center justify-between bg-indigo-950/90 border border-indigo-500/40 backdrop-blur rounded-xl px-4 py-3">
          <span className="text-sm text-indigo-300">Unsaved changes</span>
          <div className="flex gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 flex items-center gap-1">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{saveError}</div>
      )}

      {/* ── SECTION 1: Signal Thresholds ── */}
      <div className="glass rounded-xl p-6">
        <h2 className="font-semibold text-slate-100 mb-1">Signal Thresholds</h2>
        <p className="text-sm text-slate-400 mb-5">
          Kronos must predict at least this return for a position to be touched. The dead zone between -min and +min is ignored.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <SliderField
            label="Min Signal Threshold"
            value={parseFloat(config.kronosMinSignalPct)}
            min={0.1} max={5} step={0.1}
            unit="%"
            description="Predicted return must exceed this to trigger a trade. Lower = more active."
            onChange={(v) => update("kronosMinSignalPct", String(v))}
          />
          <div className="p-4 bg-white/5 rounded-lg text-sm text-slate-400 flex flex-col justify-center">
            <p className="font-medium text-slate-300 mb-1">How it works</p>
            <p>Predicted return &gt; +{config.kronosMinSignalPct}% → BUY candidate</p>
            <p>Predicted return &lt; -{config.kronosMinSignalPct}% → SELL candidate</p>
            <p>Between ±{config.kronosMinSignalPct}% → neutral (HOLD/SKIP)</p>
          </div>
        </div>
      </div>

      {/* ── SECTION 2: Proportional Sizing ── */}
      <div className="glass rounded-xl p-6">
        <h2 className="font-semibold text-slate-100 mb-1">Signal-Proportional Sizing</h2>
        <p className="text-sm text-slate-400 mb-5">
          Trade size scales with signal strength — stronger signal, bigger position change.
          For BUYs, this is % of deployable cash. For SELLs, % of the position to exit.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <SliderField
            label="Min Trade Size"
            value={parseFloat(config.kronosMinTradePct)}
            min={5} max={50} step={5}
            unit="%"
            description={`Size at exactly ±${config.kronosMinSignalPct}% signal`}
            onChange={(v) => update("kronosMinTradePct", String(v))}
          />
          <SliderField
            label="Max Trade Size"
            value={parseFloat(config.kronosMaxTradePct)}
            min={20} max={100} step={5}
            unit="%"
            description={`Size at ±${config.kronosSaturationPct}%+ signal`}
            onChange={(v) => update("kronosMaxTradePct", String(v))}
          />
          <SliderField
            label="Saturation Point"
            value={parseFloat(config.kronosSaturationPct)}
            min={1} max={15} step={0.5}
            unit="%"
            description="Signal level where max size kicks in"
            onChange={(v) => update("kronosSaturationPct", String(v))}
          />
        </div>

        {/* Curve type selector */}
        <div className="mb-6">
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Curve Shape</p>
          <div className="flex gap-3">
            {(["linear", "log", "power"] as SizingCurve[]).map((curve) => (
              <button
                key={curve}
                onClick={() => update("kronosSizingCurve", curve)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  config.kronosSizingCurve === curve
                    ? "bg-indigo-600 text-white"
                    : "bg-white/5 text-slate-400 hover:text-slate-200"
                }`}
              >
                {curve === "linear" ? "Linear" : curve === "log" ? "Logarithmic" : "Power"}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {config.kronosSizingCurve === "linear" && "Trade size grows evenly with signal strength. Easy to reason about."}
            {config.kronosSizingCurve === "log" && "Grows fast near the threshold, tapers at higher signals. Good if signals cluster near the min."}
            {config.kronosSizingCurve === "power" && "Slow early, then aggressive above the saturation midpoint. Conservative until you have high conviction."}
          </p>
        </div>

        {/* Live curve preview */}
        <CurvePreview
          curvePoints={curvePoints}
          minSignal={sizingConfig.kronosMinSignalPct}
          saturation={sizingConfig.kronosSaturationPct}
          minTrade={sizingConfig.kronosMinTradePct}
          maxTrade={sizingConfig.kronosMaxTradePct}
        />

        {/* Example signal → size table */}
        <div className="mt-6">
          <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Example Signal → Trade Size</p>
          <div className="flex flex-wrap gap-2">
            {exampleSignals.map((sig) => {
              const pct = computeKronosTradePct(sig, sizingConfig);
              return (
                <div key={sig} className="px-3 py-2 bg-white/5 rounded-lg text-center min-w-[70px]">
                  <p className="text-xs text-slate-500">±{sig}%</p>
                  <p className={`text-sm font-medium ${pct == null ? "text-slate-600" : "text-indigo-300"}`}>
                    {pct == null ? "skip" : `${pct}%`}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── SECTION 3: Ticker Universe ── */}
      <div className="glass rounded-xl p-6">
        <h2 className="font-semibold text-slate-100 mb-1">Kronos Ticker Universe</h2>
        <p className="text-sm text-slate-400 mb-4">
          Tickers Kronos will forecast. Kronos signals are the primary rotation driver for these.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {config.kronosTickerUniverse.map((t) => (
            <span key={t} className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 text-sm rounded-lg">
              {t}
              <button onClick={() => removeTicker(t)} className="text-indigo-400 hover:text-red-400 text-xs leading-none">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTicker(tickerInput); } }}
            placeholder="Add ticker (e.g. AAPL)"
            className="flex-1 glass rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-600"
          />
          <button
            onClick={() => addTicker(tickerInput)}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm"
          >
            Add
          </button>
        </div>
      </div>

      {/* ── SECTION 4: Risk Controls ── */}
      <div className="glass rounded-xl p-6">
        <h2 className="font-semibold text-slate-100 mb-1">Risk Controls</h2>
        <p className="text-sm text-slate-400 mb-5">Hard limits applied after every signal — Kronos can&apos;t breach these.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <NumberField
            label="Max Positions"
            value={config.maxPositions}
            min={1} max={50}
            description="Maximum concurrent holdings"
            onChange={(v) => update("maxPositions", v)}
          />
          <SliderField
            label="Max Position Size"
            value={parseFloat(config.maxPositionPct)}
            min={1} max={50} step={1}
            unit="%"
            description="Max % of portfolio in any single stock"
            onChange={(v) => update("maxPositionPct", String(v))}
          />
          <SliderField
            label="Min Cash Reserve"
            value={parseFloat(config.minCashReservePct)}
            min={0} max={30} step={1}
            unit="%"
            description="Pipeline won't spend below this cash floor"
            onChange={(v) => update("minCashReservePct", String(v))}
          />
          <SliderField
            label="AI Confidence Floor"
            value={parseFloat(config.minConfidenceThreshold)}
            min={0.1} max={0.99} step={0.05}
            unit=""
            description="Claude must self-rate confidence above this or the trade is skipped"
            onChange={(v) => update("minConfidenceThreshold", String(v))}
          />
        </div>
      </div>

      {/* ── SECTION 5: Advanced / Model Config ── */}
      <details className="glass rounded-xl">
        <summary className="px-6 py-4 cursor-pointer font-semibold text-slate-100 flex items-center justify-between">
          <span>Advanced / Model Config</span>
          <span className="text-slate-500 text-sm font-normal">Earnings window, lookback</span>
        </summary>
        <div className="px-6 pb-6 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <NumberField
            label="Earnings Lookback Days"
            value={config.earningsLookbackDays}
            min={1} max={30}
            description="Days back to pull earnings signals"
            onChange={(v) => update("earningsLookbackDays", v)}
          />
          <NumberField
            label="Earnings Forward Days"
            value={config.earningsForwardDays}
            min={1} max={30}
            description="Days forward to flag upcoming earnings"
            onChange={(v) => update("earningsForwardDays", v)}
          />
        </div>
      </details>
    </div>
  );
}

// ── Sub-components ──

function SliderField({
  label, value, min, max, step, unit, description, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; description: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-1">
        <label className="text-sm font-medium text-slate-300">{label}</label>
        <span className="text-sm font-mono text-indigo-300">{value}{unit}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-indigo-500"
      />
      <p className="text-xs text-slate-500 mt-1">{description}</p>
    </div>
  );
}

function NumberField({
  label, value, min, max, description, onChange,
}: {
  label: string; value: number; min: number; max: number;
  description: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-300 block mb-1">{label}</label>
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="glass rounded-lg px-3 py-2 text-slate-100 text-sm w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <p className="text-xs text-slate-500 mt-1">{description}</p>
    </div>
  );
}

/**
 * Simple SVG curve preview — no external chart library needed.
 * Renders a 400×120 viewBox with the sizing curve and key reference lines.
 */
function CurvePreview({
  curvePoints, minSignal, saturation, minTrade, maxTrade,
}: {
  curvePoints: Array<{ signal: number; tradePct: number }>;
  minSignal: number; saturation: number; minTrade: number; maxTrade: number;
}) {
  const W = 400; const H = 120;
  const PAD = { top: 12, right: 16, bottom: 28, left: 40 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxSig = saturation + 2;
  const xScale = (sig: number) => (sig / maxSig) * chartW;
  const yScale = (pct: number) => chartH - ((pct / 100) * chartH);

  // Build SVG polyline points (only points above dead zone)
  const activePoints = curvePoints.filter((p) => p.signal >= minSignal);
  const polyline = activePoints
    .map((p) => `${PAD.left + xScale(p.signal)},${PAD.top + yScale(p.tradePct)}`)
    .join(" ");

  // Key x positions
  const xMin = PAD.left + xScale(minSignal);
  const xSat = PAD.left + xScale(saturation);

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">Curve Preview</p>
      <div className="bg-slate-900/50 rounded-lg p-2 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <g key={pct}>
              <line
                x1={PAD.left} y1={PAD.top + yScale(pct)}
                x2={W - PAD.right} y2={PAD.top + yScale(pct)}
                stroke="#334155" strokeWidth="0.5"
              />
              <text x={PAD.left - 4} y={PAD.top + yScale(pct) + 3.5}
                textAnchor="end" fontSize="8" fill="#64748b">{pct}%</text>
            </g>
          ))}

          {/* Dead zone shading */}
          <rect
            x={PAD.left} y={PAD.top}
            width={xMin - PAD.left} height={chartH}
            fill="#ef444410"
          />

          {/* Saturation reference line */}
          <line
            x1={xSat} y1={PAD.top}
            x2={xSat} y2={PAD.top + chartH}
            stroke="#6366f140" strokeWidth="1" strokeDasharray="3,3"
          />

          {/* Min signal reference line */}
          <line
            x1={xMin} y1={PAD.top}
            x2={xMin} y2={PAD.top + chartH}
            stroke="#ef444460" strokeWidth="1" strokeDasharray="3,3"
          />

          {/* The curve */}
          {activePoints.length > 1 && (
            <polyline points={polyline} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* Min trade dot */}
          <circle cx={xMin} cy={PAD.top + yScale(minTrade)} r="3" fill="#6366f1" />
          {/* Max trade dot */}
          <circle cx={xSat} cy={PAD.top + yScale(maxTrade)} r="3" fill="#6366f1" />

          {/* X-axis labels */}
          <text x={xMin} y={H - 4} textAnchor="middle" fontSize="8" fill="#64748b">±{minSignal}%</text>
          <text x={xSat} y={H - 4} textAnchor="middle" fontSize="8" fill="#64748b">±{saturation}%</text>
          <text x={W - PAD.right} y={H - 4} textAnchor="end" fontSize="8" fill="#64748b">signal →</text>

          {/* Y-axis label */}
          <text x={8} y={PAD.top + chartH / 2} textAnchor="middle" fontSize="8" fill="#64748b"
            transform={`rotate(-90, 8, ${PAD.top + chartH / 2})`}>trade %</text>
        </svg>
      </div>
    </div>
  );
}

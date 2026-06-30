# Kronos Tuning Page + Proportional Signal Sizing — Build Spec

**Status:** Ready to implement  
**Goal:** Replace flat `kronosRebalancePct` with a signal-scaled sizing curve, and build a proper Tune tab on the pipeline detail page so Kronos is no longer a black box.

---

## Overview of Changes

1. **DB migration** — Replace `kronosRebalancePct` with 3 new columns + a sizing curve field (both `pipelines` and `strategy_templates` tables)
2. **`pipeline-defaults.ts`** — New defaults for the 4 new fields
3. **`pipeline-config.ts`** — Add new fields to `INHERITABLE_FIELDS`
4. **New shared util `src/lib/kronos-sizing.ts`** — Pure function for computing trade size from signal
5. **`pipeline-prompt.ts`** — Updated Kronos section instructs Claude to use signal-proportional sizing
6. **`pipeline/run/route.ts`** — Server-side sizing enforcement (guard against Claude going rogue on sharesPct)
7. **`/api/pipelines/[id]` PATCH** — Handle new fields
8. **Pipeline detail page** — New "Tune" tab with live curve preview chart + all tweakable params
9. **Tests** — Full coverage of sizing util, prompt changes, API changes, UI

---

## 1. DB Migration

### 1a. Remove `kronosRebalancePct`, add 4 new columns

On BOTH `pipelines` and `strategy_templates` tables:

```sql
-- Remove old flat rebalance param
ALTER TABLE pipelines DROP COLUMN IF EXISTS kronos_rebalance_pct;
ALTER TABLE strategy_templates DROP COLUMN IF EXISTS kronos_rebalance_pct;

-- Add proportional sizing params
ALTER TABLE pipelines
  ADD COLUMN kronos_min_trade_pct  DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN kronos_max_trade_pct  DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  ADD COLUMN kronos_saturation_pct DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN kronos_sizing_curve   TEXT         NOT NULL DEFAULT 'linear';

ALTER TABLE strategy_templates
  ADD COLUMN kronos_min_trade_pct  DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  ADD COLUMN kronos_max_trade_pct  DECIMAL(5,2) NOT NULL DEFAULT 80.00,
  ADD COLUMN kronos_saturation_pct DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  ADD COLUMN kronos_sizing_curve   TEXT         NOT NULL DEFAULT 'linear';
```

Generate via `drizzle-kit generate` + `drizzle-kit migrate`. The column drop must be in a separate migration step if Drizzle doesn't do it inline — check the generated SQL before applying.

### 1b. Schema changes in `src/db/schema.ts`

In BOTH `pipelines` and `strategyTemplates` table definitions:

```typescript
// REMOVE:
kronosRebalancePct: decimal("kronos_rebalance_pct", { precision: 5, scale: 2 }).default("50.00"),

// ADD:
kronosMinTradePct:  decimal("kronos_min_trade_pct",  { precision: 5, scale: 2 }).notNull().default("20.00"),
kronosMaxTradePct:  decimal("kronos_max_trade_pct",  { precision: 5, scale: 2 }).notNull().default("80.00"),
kronosSaturationPct: decimal("kronos_saturation_pct", { precision: 5, scale: 2 }).notNull().default("5.00"),
kronosSizingCurve:  text("kronos_sizing_curve").notNull().default("linear"),
```

---

## 2. `src/lib/pipeline-defaults.ts`

```typescript
// REMOVE:
kronosRebalancePct: "50.00",

// ADD:
kronosMinTradePct:  "20.00",
kronosMaxTradePct:  "80.00",
kronosSaturationPct: "5.00",
kronosSizingCurve:  "linear" as const,
```

Update `INHERITABLE_FIELDS`:
```typescript
// REMOVE: "kronosRebalancePct"
// ADD: "kronosMinTradePct", "kronosMaxTradePct", "kronosSaturationPct", "kronosSizingCurve"
```

---

## 3. New File: `src/lib/kronos-sizing.ts`

This is the pure math core. Everything else calls into this.

```typescript
export type SizingCurve = "linear" | "log" | "power";

export interface KronosSizingConfig {
  kronosMinSignalPct: number;   // dead zone gate (e.g. 1.0)
  kronosMinTradePct: number;    // trade size at min signal (e.g. 20)
  kronosMaxTradePct: number;    // trade size at saturation (e.g. 80)
  kronosSaturationPct: number;  // signal level where max size kicks in (e.g. 5.0)
  kronosSizingCurve: SizingCurve;
}

/**
 * Compute trade size as a % of position (for SELL) or % of deployable cash (for BUY).
 *
 * Returns null if signal magnitude is below the min signal threshold (no trade).
 * Returns a value clamped between kronosMinTradePct and kronosMaxTradePct.
 *
 * Curve shapes:
 *   linear — t grows linearly from 0→1 as signal goes from minSignal→saturation
 *   log    — t grows fast early, then tapers (good if signals cluster near threshold)
 *   power  — t grows slowly then accelerates (conservative until high conviction)
 */
export function computeKronosTradePct(
  signalMagnitude: number,  // |predictedReturnPct|, always positive
  config: KronosSizingConfig
): number | null {
  const {
    kronosMinSignalPct,
    kronosMinTradePct,
    kronosMaxTradePct,
    kronosSaturationPct,
    kronosSizingCurve,
  } = config;

  if (signalMagnitude < kronosMinSignalPct) return null;  // below dead zone

  const range = kronosSaturationPct - kronosMinSignalPct;
  if (range <= 0) return kronosMaxTradePct; // degenerate config, go max

  const raw = (signalMagnitude - kronosMinSignalPct) / range;
  const tRaw = Math.min(1, Math.max(0, raw));

  let t: number;
  switch (kronosSizingCurve) {
    case "log":
      // log(1 + 9t) / log(10) → maps 0→0, 1→1 with fast early growth
      t = Math.log1p(9 * tRaw) / Math.log(10);
      break;
    case "power":
      // t^2 → slow start, fast finish
      t = tRaw * tRaw;
      break;
    case "linear":
    default:
      t = tRaw;
  }

  return Math.round(kronosMinTradePct + t * (kronosMaxTradePct - kronosMinTradePct));
}

/**
 * Generate N sample points for the curve preview chart.
 * Returns array of { signal: number, tradePct: number } from minSignal to saturation+2%.
 */
export function generateCurvePoints(
  config: KronosSizingConfig,
  nPoints = 50
): Array<{ signal: number; tradePct: number }> {
  const maxSignal = config.kronosSaturationPct + 2;
  const points: Array<{ signal: number; tradePct: number }> = [];

  for (let i = 0; i <= nPoints; i++) {
    const signal = (i / nPoints) * maxSignal;
    const tradePct = computeKronosTradePct(signal, config);
    points.push({ signal: parseFloat(signal.toFixed(2)), tradePct: tradePct ?? 0 });
  }

  return points;
}
```

---

## 4. `src/lib/pipeline-prompt.ts` — Updated Kronos Section

Update `PipelineConfigForPrompt` interface:

```typescript
export interface PipelineConfigForPrompt {
  // ... existing fields ...
  // REMOVE: kronosRebalancePct?: string | null;
  // ADD:
  kronosMinTradePct?: string | null;
  kronosMaxTradePct?: string | null;
  kronosSaturationPct?: string | null;
  kronosSizingCurve?: string | null;
}
```

Update the `buildPrompt` function's Kronos section. Import `computeKronosTradePct` from `./kronos-sizing`:

```typescript
import { computeKronosTradePct, type SizingCurve } from "./kronos-sizing";

// Inside buildPrompt, replace the kronosSectionText block:
if (kronosForecasts && kronosForecasts.length > 0) {
  const minSignalPct = parseFloat(pipeline.kronosMinSignalPct ?? "1.00");
  const sizingConfig = {
    kronosMinSignalPct: minSignalPct,
    kronosMinTradePct:  parseFloat(pipeline.kronosMinTradePct  ?? "20"),
    kronosMaxTradePct:  parseFloat(pipeline.kronosMaxTradePct  ?? "80"),
    kronosSaturationPct: parseFloat(pipeline.kronosSaturationPct ?? "5.00"),
    kronosSizingCurve:  (pipeline.kronosSizingCurve ?? "linear") as SizingCurve,
  };

  const sortedForecasts = [...kronosForecasts].sort(
    (a, b) => b.predictedReturnPct - a.predictedReturnPct
  );

  const forecastRows = sortedForecasts.map((f) => {
    const mag = Math.abs(f.predictedReturnPct);
    const sizePct = computeKronosTradePct(mag, sizingConfig);
    const sizeHint = sizePct != null ? ` → trade ${sizePct}%` : " → below threshold";
    return (
      `${f.ticker.padEnd(6)} | ${(f.predictedReturnPct >= 0 ? "+" : "") + f.predictedReturnPct.toFixed(2)}%${sizeHint}`
    );
  }).join("\n");

  kronosSectionText = `
## Kronos AI Forecasts (24h predicted return, sorted descending)
Ticker | Predicted Return | Suggested Trade Size
${forecastRows}

Kronos signal rules:
- BUY candidates: tickers with predicted return > +${minSignalPct}% 
- SELL candidates: tickers you hold with predicted return < -${minSignalPct}%
- Trade size (sharesPct) is pre-computed based on signal strength and shown above — use the suggested size unless portfolio constraints prevent it
- The sizing curve is ${sizingConfig.kronosSizingCurve}: at ±${minSignalPct}% the trade is ${sizingConfig.kronosMinTradePct}%, at ±${sizingConfig.kronosSaturationPct}% or above it's ${sizingConfig.kronosMaxTradePct}%
- For BUY: sharesPct = suggested % of deployable cash to allocate
- For SELL: sharesPct = suggested % of the current position to exit
- Tickers between -${minSignalPct}% and +${minSignalPct}% → HOLD or SKIP
- Kronos signals are PRIMARY; earnings signals are SECONDARY confirmation
`;
}
```

---

## 5. `src/app/api/pipeline/run/route.ts` — Server-Side Sizing Guard

After the AI returns decisions and before the trade loop, add a sizing enforcement pass for `kronos_rotation` pipelines. This caps Claude's `sharesPct` to what the curve dictates, so Claude can't hallucinate a wild position size.

Import at top:
```typescript
import { computeKronosTradePct, type SizingCurve } from "@/lib/kronos-sizing";
```

After `const validDecisions = ...` line, add:

```typescript
// Kronos sizing guard: clamp sharesPct to curve-computed value for kronos_rotation
if (pipeline.strategyType === "kronos_rotation") {
  const sizingConfig = {
    kronosMinSignalPct:  parseFloat(pipeline.kronosMinSignalPct  ?? "1.00"),
    kronosMinTradePct:   parseFloat(pipeline.kronosMinTradePct   ?? "20.00"),
    kronosMaxTradePct:   parseFloat(pipeline.kronosMaxTradePct   ?? "80.00"),
    kronosSaturationPct: parseFloat(pipeline.kronosSaturationPct ?? "5.00"),
    kronosSizingCurve:   (pipeline.kronosSizingCurve ?? "linear") as SizingCurve,
  };

  for (const decision of validDecisions) {
    if (decision.action !== "BUY" && decision.action !== "SELL") continue;
    const forecast = kronosForecastData.find((f) => f.ticker === decision.ticker);
    if (!forecast) continue;

    const mag = Math.abs(forecast.predictedReturnPct);
    const authorizedPct = computeKronosTradePct(mag, sizingConfig);

    if (authorizedPct == null) {
      // Signal fell below threshold — downgrade to SKIP
      decision.action = "SKIP";
      decision.reasoning = `[Sizing guard] Signal magnitude ${mag.toFixed(2)}% is below threshold ${sizingConfig.kronosMinSignalPct}% after guard check. Downgraded to SKIP.`;
      continue;
    }

    // Clamp Claude's sharesPct to ±20% of authorized value (give Claude some discretion, but don't let it go wild)
    const allowedMin = Math.max(1, authorizedPct * 0.8);
    const allowedMax = authorizedPct * 1.2;
    if (decision.sharesPct != null) {
      decision.sharesPct = Math.min(allowedMax, Math.max(allowedMin, decision.sharesPct));
    } else {
      decision.sharesPct = authorizedPct;
    }
  }
}
```

Also update the `PipelineConfigForPrompt` pass into `buildPrompt` to include the new fields (remove `kronosRebalancePct`, add the 4 new ones).

Update `inputFields` in the PATCH route to include the new Kronos fields (see §6).

---

## 6. `src/app/api/pipelines/[id]/route.ts` — PATCH Handler

In the `PATCH` function, add the new Kronos fields to `inputFields`:

```typescript
const inputFields = [
  "thesis", "strategyType", "tickerUniverse",
  "maxPositions", "maxPositionPct", "minCashReservePct",
  "earningsLookbackDays", "earningsForwardDays",
  "minConfidenceThreshold", "autonomous", "allowShortSell",
  "rebalanceOnRun", "hypothesisConfig",
  "kronosTickerUniverse",
  // REMOVE: "kronosRebalancePct"
  // ADD:
  "kronosMinSignalPct",
  "kronosMinTradePct", "kronosMaxTradePct", "kronosSaturationPct", "kronosSizingCurve",
];
```

Add the new fields to the `updates` object:
```typescript
kronosTickerUniverse: resolved.kronosTickerUniverse,
kronosMinSignalPct:   String(resolved.kronosMinSignalPct),
kronosMinTradePct:    String(resolved.kronosMinTradePct),
kronosMaxTradePct:    String(resolved.kronosMaxTradePct),
kronosSaturationPct:  String(resolved.kronosSaturationPct),
kronosSizingCurve:    resolved.kronosSizingCurve,
// REMOVE: kronosRebalancePct
```

---

## 7. New UI: "Tune" Tab on Pipeline Detail Page

### 7a. Add "Tune" tab to the tabs array

In `src/app/(dashboard)/pipelines/[id]/page.tsx`, add `"tune"` to the `Tab` type and `TABS` array:

```typescript
type Tab = "overview" | "runs" | "decisions" | "settings" | "tune";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "runs",     label: "Run History" },
  { key: "decisions", label: "Decision Log" },
  { key: "tune",     label: "Tune" },      // ← NEW
  { key: "settings", label: "Settings" },
];
```

Show the Tune tab only for `kronos_rotation` pipelines (hide it otherwise to keep the nav clean for other strategy types):
```typescript
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "runs",     label: "Run History" },
  { key: "decisions", label: "Decision Log" },
  ...(pipeline.strategyType === "kronos_rotation" ? [{ key: "tune" as Tab, label: "⚙️ Tune" }] : []),
  { key: "settings", label: "Settings" },
];
```

### 7b. New Component: `src/components/KronosTunePanel.tsx`

This is the main Tune tab UI. It's a controlled form with live preview.

```typescript
"use client";

import { useState, useCallback, useEffect } from "react";
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
        <p className="text-sm text-slate-400 mb-5">Hard limits applied after every signal — Kronos can't breach these.</p>
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

      {/* ── SECTION 5: Model Config (collapsed by default) ── */}
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
```

### 7c. Wire it into the pipeline detail page

In `src/app/(dashboard)/pipelines/[id]/page.tsx`:

```typescript
import { KronosTunePanel } from "@/components/KronosTunePanel";

// Inside the "tune" tab section:
{tab === "tune" && pipeline.strategyType === "kronos_rotation" && (
  <KronosTunePanel
    pipelineId={id}
    initial={{
      kronosMinSignalPct:  String(pipeline.kronosMinSignalPct  ?? "1.00"),
      kronosMinTradePct:   String(pipeline.kronosMinTradePct   ?? "20.00"),
      kronosMaxTradePct:   String(pipeline.kronosMaxTradePct   ?? "80.00"),
      kronosSaturationPct: String(pipeline.kronosSaturationPct ?? "5.00"),
      kronosSizingCurve:   String(pipeline.kronosSizingCurve   ?? "linear") as SizingCurve,
      kronosTickerUniverse: (pipeline.kronosTickerUniverse as string[]) ?? [],
      maxPositions:           Number(pipeline.maxPositions ?? 10),
      maxPositionPct:         String(pipeline.maxPositionPct ?? "10.00"),
      minCashReservePct:      String(pipeline.minCashReservePct ?? "5.00"),
      minConfidenceThreshold: String(pipeline.minConfidenceThreshold ?? "0.65"),
      earningsLookbackDays:   Number(pipeline.earningsLookbackDays ?? 3),
      earningsForwardDays:    Number(pipeline.earningsForwardDays ?? 7),
    }}
    onSaved={fetchData}
  />
)}
```

---

## 8. Tests

### `tests/lib/kronos-sizing.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { computeKronosTradePct, generateCurvePoints } from "@/lib/kronos-sizing";

const BASE = {
  kronosMinSignalPct: 1,
  kronosMinTradePct: 20,
  kronosMaxTradePct: 80,
  kronosSaturationPct: 5,
  kronosSizingCurve: "linear" as const,
};

describe("computeKronosTradePct", () => {
  it("returns null below threshold", () => {
    expect(computeKronosTradePct(0.5, BASE)).toBeNull();
    expect(computeKronosTradePct(0.99, BASE)).toBeNull();
  });

  it("returns minTradePct at exactly the threshold", () => {
    expect(computeKronosTradePct(1, BASE)).toBe(20);
  });

  it("returns maxTradePct at saturation", () => {
    expect(computeKronosTradePct(5, BASE)).toBe(80);
  });

  it("returns maxTradePct above saturation (clamped)", () => {
    expect(computeKronosTradePct(10, BASE)).toBe(80);
  });

  it("interpolates linearly at midpoint", () => {
    // signal=3, midpoint between 1 and 5 → t=0.5 → 20 + 0.5*(80-20) = 50
    expect(computeKronosTradePct(3, BASE)).toBe(50);
  });

  it("log curve grows faster near threshold", () => {
    const logResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "log" });
    const linResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "linear" });
    expect(logResult!).toBeGreaterThan(linResult!);
  });

  it("power curve grows slower near threshold", () => {
    const powResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "power" });
    const linResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "linear" });
    expect(powResult!).toBeLessThan(linResult!);
  });

  it("handles degenerate config where saturation <= minSignal", () => {
    expect(computeKronosTradePct(3, { ...BASE, kronosSaturationPct: 1 })).toBe(80);
  });
});

describe("generateCurvePoints", () => {
  it("returns expected number of points", () => {
    const pts = generateCurvePoints(BASE, 50);
    expect(pts).toHaveLength(51); // 0..nPoints inclusive
  });

  it("first point has tradePct=0 (below threshold)", () => {
    const pts = generateCurvePoints(BASE, 50);
    expect(pts[0].tradePct).toBe(0);
  });

  it("all tradePct values are within [0, maxTradePct]", () => {
    const pts = generateCurvePoints(BASE, 50);
    for (const p of pts) {
      expect(p.tradePct).toBeGreaterThanOrEqual(0);
      expect(p.tradePct).toBeLessThanOrEqual(BASE.kronosMaxTradePct);
    }
  });
});
```

### `tests/lib/pipeline-prompt-kronos-sizing.test.ts`

| Test | Expected |
|---|---|
| `buildPrompt` with kronos forecasts includes "trade X%" hint per ticker | ✓ |
| Ticker at 0.5% (below threshold) shows "below threshold" in hint | ✓ |
| Ticker at 5% shows max trade size in hint | ✓ |

### `tests/api/pipeline-run-kronos-sizing.test.ts`

| Test | Expected |
|---|---|
| Decision with sharesPct 99 for signal 1.5% → clamped to ~24 (20 + 20% buffer) | ✓ |
| Decision with signal below threshold → downgraded to SKIP | ✓ |
| Non-kronos pipeline → sizing guard not applied | ✓ |

### `tests/components/KronosTunePanel.test.tsx`

| Test | Expected |
|---|---|
| Renders all 4 sections | ✓ |
| Changing min signal slider updates curve preview example table | ✓ |
| Curve type buttons toggle correctly | ✓ |
| Save calls PATCH with correct payload | ✓ |
| Reset restores initial values | ✓ |
| Adding a ticker via input appends to list | ✓ |
| Removing ticker via × removes from list | ✓ |

---

## 9. Migration Order

1. `npx drizzle-kit generate` — review SQL for correct column drops + adds
2. `npx drizzle-kit migrate` — apply to Neon
3. Deploy app (Vercel auto-deploys on push to main)
4. Existing pipelines get new columns with sensible defaults (20/80/5/linear) automatically

No backfill needed — defaults are reasonable starting points for any existing `kronos_rotation` pipeline.

---

## Summary of New Params

| Old | New | Default |
|---|---|---|
| `kronosRebalancePct: 50%` (flat sell size) | `kronosMinTradePct: 20%` | Min trade at threshold |
| *(removed)* | `kronosMaxTradePct: 80%` | Max trade at saturation |
| *(removed)* | `kronosSaturationPct: 5%` | Signal level for max size |
| *(removed)* | `kronosSizingCurve: linear` | Curve shape |

The sizing is enforced both in the prompt (Claude gets told what size to use) and server-side (execution guard clamps any deviation to ±20% of the computed value).

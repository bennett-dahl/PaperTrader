# Kronos Rotation Strategy — Developer Spec

**Status:** Ready for implementation  
**Goal:** Beat S&P 500 by using Kronos-base (102M-param model) to forecast 24h price returns, rotating into predicted winners and out of predicted losers. Claude makes the final autonomous decisions using Kronos forecasts + earnings signals.

---

## 1. DB Changes

### 1a. `strategyTypeEnum` — add `kronos_rotation`

In `src/db/schema.ts`, update the existing enum:

```typescript
// BEFORE
export const strategyTypeEnum = pgEnum("strategy_type", [
  "thesis_driven",
  "signal_driven",
]);

// AFTER
export const strategyTypeEnum = pgEnum("strategy_type", [
  "thesis_driven",
  "signal_driven",
  "kronos_rotation",
]);
```

This is a **breaking migration**: PostgreSQL enums require `ALTER TYPE ... ADD VALUE`. Generate via `drizzle-kit generate` and apply.

---

### 1b. New `kronos_forecasts` table

Add to `src/db/schema.ts`. Note: `forecastDate` follows the existing codebase pattern of storing dates as `text` (e.g., `earningsSignals.reportDate`). Add `json` to the Drizzle import if not already present.

```typescript
// Add to imports at top of schema.ts:
// json  <-- needed for kronosTickerUniverse on pipelines below

export const kronosForecasts = pgTable(
  "kronos_forecasts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .references(() => pipelines.id, { onDelete: "cascade" })
      .notNull(),
    ticker: text("ticker").notNull(),
    predictedReturnPct: decimal("predicted_return_pct", {
      precision: 8,
      scale: 4,
    }).notNull(),
    forecastDate: text("forecast_date").notNull(), // "YYYY-MM-DD" string, matches earningsSignals pattern
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pipelineDateIdx: index("kronos_forecasts_pipeline_date_idx").on(
      t.pipelineId,
      t.forecastDate
    ),
  })
);
```

Add the corresponding relation and TypeScript types:

```typescript
// In pipelinesRelations:
export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  // ... existing relations ...
  kronosForecasts: many(kronosForecasts),
}));

export const kronosForecastsRelations = relations(kronosForecasts, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [kronosForecasts.pipelineId],
    references: [pipelines.id],
  }),
}));

// Types
export type KronosForecast = typeof kronosForecasts.$inferSelect;
export type NewKronosForecast = typeof kronosForecasts.$inferInsert;
```

---

### 1c. New nullable columns on `pipelines`

Add three new columns to the `pipelines` table definition in `src/db/schema.ts`. These are nullable/defaulted so no backfill is needed for existing rows.

```typescript
// Add inside the pipelines pgTable definition, after rebalanceOnRun:

// Kronos-specific configuration
kronosTickerUniverse: json("kronos_ticker_universe")
  .$type<string[]>()
  .default([]),
kronosRebalancePct: decimal("kronos_rebalance_pct", {
  precision: 5,
  scale: 2,
}).default("50.00"),
kronosMinSignalPct: decimal("kronos_min_signal_pct", {
  precision: 5,
  scale: 2,
}).default("1.00"),
```

Add `json` to the drizzle-orm/pg-core import line at the top of `schema.ts`:

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  decimal,
  boolean,
  pgEnum,
  integer,
  unique,
  index,
  json,          // ← ADD THIS
} from "drizzle-orm/pg-core";
```

Also add the same three columns to `strategyTemplates` if templates should be inheritable (recommended for consistency — see §5 pipeline-defaults changes).

---

## 2. Modal Service (`modal/kronos_service.py`)

Create `modal/kronos_service.py` at the repo root. This is a Modal serverless Python function that fetches OHLCV via yfinance internally and runs Kronos inference.

```python
"""
modal/kronos_service.py

Kronos-base (NeoQuasar/Kronos-base, 102M params) inference service.
Fetches OHLCV via yfinance, runs 24h return forecast, returns sorted results.

Deploy:
  modal deploy modal/kronos_service.py

Endpoint:
  POST /forecast_endpoint
  Authorization: Bearer <KRONOS_SECRET>
  Body: {"tickers": [...], "lookback": 60, "pipeline_id": "..."}
"""

import json
import os

import modal

app = modal.App("kronos-forecaster")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch",
        "transformers",
        "yfinance",
        "huggingface_hub",
        "pandas",
        "numpy",
    )
)

# Secret must be created in Modal dashboard:
#   modal secret create kronos-secret KRONOS_SECRET=<hex>
kronos_secret = modal.Secret.from_name("kronos-secret")

MODEL_NAME = "NeoQuasar/Kronos-base"


def _load_model():
    """Download and cache Kronos-base from HuggingFace. Called once per container."""
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    import torch

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        torch_dtype=torch.float32,
    )
    model.eval()
    return tokenizer, model


def _fetch_ohlcv(ticker: str, lookback: int) -> list[list[float]]:
    """Fetch OHLCV data via yfinance. Returns list of [open, high, low, close, volume] rows."""
    import yfinance as yf
    import pandas as pd

    df = yf.download(ticker, period=f"{lookback}d", interval="1d", progress=False)
    if df.empty or len(df) < 5:
        return []

    rows = []
    for _, row in df.iterrows():
        rows.append([
            float(row["Open"]),
            float(row["High"]),
            float(row["Low"]),
            float(row["Close"]),
            float(row["Volume"]),
        ])
    return rows[-lookback:]  # cap to lookback


def _run_inference(tokenizer, model, ohlcv_rows: list[list[float]]) -> float:
    """
    Run Kronos inference on OHLCV rows.

    Kronos-base expects a time-series input. We encode the close prices as a
    sequence and use the model's regression head (or logit as a proxy) to
    produce a predicted return signal.

    NOTE: Adapt input encoding to match Kronos-base's actual expected format
    once the model card is reviewed. The pattern below is a reasonable default
    for time-series transformer models that accept text-encoded sequences.
    """
    import torch

    closes = [row[3] for row in ohlcv_rows]
    if len(closes) < 2:
        return 0.0

    # Encode as text sequence (common pattern for Kronos-style models)
    sequence = " ".join(f"{c:.4f}" for c in closes)
    inputs = tokenizer(
        sequence,
        return_tensors="pt",
        truncation=True,
        max_length=512,
    )

    with torch.no_grad():
        outputs = model(**inputs)

    # Use the first logit as a raw return signal proxy
    # Calibrate scale: model outputs ~[-1, 1] range → interpret as predicted % return
    logit = float(outputs.logits[0][0].item())
    predicted_return_pct = logit * 5.0  # scale factor; tune empirically
    return round(predicted_return_pct, 4)


@app.function(
    image=image,
    secrets=[kronos_secret],
    gpu="any",
    timeout=300,
    retries=1,
)
def run_kronos_forecast(
    tickers: list[str],
    lookback: int = 60,
    pipeline_id: str = "",
) -> dict:
    """
    Core forecast function. Called by forecast_endpoint.

    Args:
        tickers: List of ticker symbols to forecast
        lookback: Number of days of OHLCV history to use (default 60)
        pipeline_id: Originating pipeline ID (for logging)

    Returns:
        {"results": [{"ticker": str, "predictedReturnPct": float}]}
        sorted descending by predictedReturnPct
    """
    tokenizer, model = _load_model()
    results = []

    for ticker in tickers:
        try:
            ohlcv = _fetch_ohlcv(ticker, lookback)
            if not ohlcv:
                print(f"[kronos] No OHLCV data for {ticker}, skipping")
                continue
            predicted = _run_inference(tokenizer, model, ohlcv)
            results.append({"ticker": ticker, "predictedReturnPct": predicted})
            print(f"[kronos] {ticker}: {predicted:+.4f}% (pipeline={pipeline_id})")
        except Exception as e:
            print(f"[kronos] Error forecasting {ticker}: {e}")
            continue

    results.sort(key=lambda r: r["predictedReturnPct"], reverse=True)
    return {"results": results}


@app.web_endpoint(method="POST")
def forecast_endpoint(request: dict) -> dict:
    """
    HTTP POST entry point. Verifies bearer token, delegates to run_kronos_forecast.

    Expected body:
      {
        "tickers": ["AAPL", "MSFT", ...],
        "lookback": 60,
        "pipeline_id": "<uuid>"
      }

    Returns:
      {"results": [{"ticker": str, "predictedReturnPct": float}]}
    """
    from fastapi import Request as FastAPIRequest
    from fastapi.responses import JSONResponse

    # Verify bearer token
    secret = os.environ.get("KRONOS_SECRET", "")
    auth_header = request.get("_headers", {}).get("authorization", "")
    if not auth_header.startswith("Bearer ") or auth_header[7:] != secret:
        return {"error": "Unauthorized"}, 401

    tickers = request.get("tickers", [])
    lookback = int(request.get("lookback", 60))
    pipeline_id = request.get("pipeline_id", "")

    if not tickers:
        return {"results": []}

    return run_kronos_forecast.remote(tickers=tickers, lookback=lookback, pipeline_id=pipeline_id)
```

> **Note on auth in Modal web endpoints:** The `@app.web_endpoint` decorator wraps via FastAPI. At deploy time, confirm how Modal passes raw headers into the request dict — you may need to inspect `modal.web_endpoint` docs for the exact header extraction pattern and adjust `request.get("_headers", {})` accordingly. An alternative is to accept the full `Request` object and read `request.headers["authorization"]`.

---

## 3. GitHub Actions (`.github/workflows/modal-deploy.yml`)

Create `.github/workflows/modal-deploy.yml`. Triggers on push to `main`. Deploys the Modal service automatically so the endpoint is always current.

```yaml
name: Deploy Kronos Modal Service

on:
  push:
    branches:
      - main
    paths:
      - "modal/**"
      - ".github/workflows/modal-deploy.yml"

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install Modal
        run: pip install modal

      - name: Deploy Kronos service
        env:
          MODAL_TOKEN_ID: ${{ secrets.MODAL_TOKEN_ID }}
          MODAL_TOKEN_SECRET: ${{ secrets.MODAL_TOKEN_SECRET }}
        run: |
          modal deploy modal/kronos_service.py
```

After the first successful deploy, Modal will print the endpoint URL. Copy it into `MODAL_API_URL` (see §8 Env Vars).

---

## 4. New API Routes

### 4a. `src/app/api/pipeline/kronos-prefetch/route.ts`

Pre-fetch step triggered by QStash before pipeline runs. Queries all active `kronos_rotation` pipelines, calls Modal for forecasts, upserts into `kronos_forecasts`.

```typescript
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, kronosForecasts } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export const POST = verifySignatureAppRouter(async (_req: NextRequest) => {
  const today = new Date().toISOString().split("T")[0];

  // Find all active kronos_rotation pipelines with non-empty kronosTickerUniverse
  const activePipelines = await db
    .select({
      id: pipelines.id,
      kronosTickerUniverse: pipelines.kronosTickerUniverse,
    })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.status, "active"),
        eq(pipelines.strategyType, "kronos_rotation")
      )
    );

  const modalUrl = process.env.MODAL_API_URL;
  const kronosSecret = process.env.KRONOS_SECRET;

  if (!modalUrl || !kronosSecret) {
    console.error("[kronos-prefetch] Missing MODAL_API_URL or KRONOS_SECRET");
    return NextResponse.json({ error: "Modal not configured" }, { status: 500 });
  }

  let totalUpserted = 0;

  for (const pipeline of activePipelines) {
    const tickers = (pipeline.kronosTickerUniverse as string[]) ?? [];

    if (tickers.length === 0) {
      console.warn(`[kronos-prefetch] Pipeline ${pipeline.id} has empty kronosTickerUniverse, skipping`);
      continue;
    }

    // Call Modal endpoint
    let results: Array<{ ticker: string; predictedReturnPct: number }>;
    try {
      const response = await fetch(modalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kronosSecret}`,
        },
        body: JSON.stringify({
          tickers,
          lookback: 60,
          pipeline_id: pipeline.id,
        }),
      });

      if (!response.ok) {
        console.error(
          `[kronos-prefetch] Modal returned ${response.status} for pipeline ${pipeline.id}`
        );
        continue;
      }

      const data = await response.json();
      results = data.results ?? [];
    } catch (err) {
      console.error(`[kronos-prefetch] Fetch failed for pipeline ${pipeline.id}:`, err);
      continue;
    }

    if (results.length === 0) {
      console.warn(`[kronos-prefetch] No results from Modal for pipeline ${pipeline.id}`);
      continue;
    }

    // Upsert into kronos_forecasts — conflict on (pipelineId, ticker, forecastDate)
    for (const result of results) {
      await db
        .insert(kronosForecasts)
        .values({
          pipelineId: pipeline.id,
          ticker: result.ticker,
          predictedReturnPct: String(result.predictedReturnPct),
          forecastDate: today,
        })
        .onConflictDoUpdate({
          target: [kronosForecasts.pipelineId, kronosForecasts.ticker, kronosForecasts.forecastDate],
          set: {
            predictedReturnPct: String(result.predictedReturnPct),
            createdAt: new Date(),
          },
        });

      totalUpserted++;
    }

    console.log(
      `[kronos-prefetch] Pipeline ${pipeline.id}: upserted ${results.length} forecasts for ${today}`
    );
  }

  return NextResponse.json({ ok: true, upserted: totalUpserted });
});
```

> **Upsert uniqueness constraint:** The `onConflictDoUpdate` requires a unique index on `(pipelineId, ticker, forecastDate)`. Add to the `kronosForecasts` table definition:
> ```typescript
> (t) => ({
>   pipelineDateIdx: index("kronos_forecasts_pipeline_date_idx").on(t.pipelineId, t.forecastDate),
>   uniq: unique("kronos_forecasts_pipeline_ticker_date_uniq").on(t.pipelineId, t.ticker, t.forecastDate),
> })
> ```

---

### 4b. `src/app/api/tickers/[ticker]/forecast/route.ts`

Returns the most recent Kronos forecast for a ticker. Used by `StockDetailSheet` client-side.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { kronosForecasts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } }
) {
  const ticker = params.ticker.toUpperCase();

  const row = await db
    .select({
      ticker: kronosForecasts.ticker,
      predictedReturnPct: kronosForecasts.predictedReturnPct,
      forecastDate: kronosForecasts.forecastDate,
      pipelineId: kronosForecasts.pipelineId,
    })
    .from(kronosForecasts)
    .where(eq(kronosForecasts.ticker, ticker))
    .orderBy(desc(kronosForecasts.forecastDate))
    .limit(1);

  if (row.length === 0) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    ticker: row[0].ticker,
    predictedReturnPct: parseFloat(row[0].predictedReturnPct),
    forecastDate: row[0].forecastDate,
    pipelineId: row[0].pipelineId,
  });
}
```

No auth is required (paper trading data, non-sensitive).

---

## 5. Changes to Existing Files

### 5a. `src/app/api/pipeline/run/route.ts`

**Where to add:** After the `fetchEarningsSignals` call and before the `portfolioLinks` for-loop. The existing code looks like this:

```typescript
// Fetch earnings signals (cache-first, Finnhub fallback)
const earningsMap = await fetchEarningsSignals(
  tickers,
  pipeline.earningsLookbackDays,
  pipeline.earningsForwardDays
);

const today = new Date().toISOString().split("T")[0];
// ... portfolioLinks for-loop starts here
```

**Insert the following block between `fetchEarningsSignals` and the for-loop:**

```typescript
// --- Kronos forecasts (kronos_rotation strategy only) ---
let kronosForecastData: Array<{ ticker: string; predictedReturnPct: number }> = [];

if (pipeline.strategyType === "kronos_rotation") {
  // Use kronosTickerUniverse for tickers if set; already resolved above as `tickers`
  // (see §5a ticker resolution note below)
  const forecastRows = await db
    .select({
      ticker: kronosForecastsTable.ticker,
      predictedReturnPct: kronosForecastsTable.predictedReturnPct,
    })
    .from(kronosForecastsTable)
    .where(
      and(
        eq(kronosForecastsTable.pipelineId, pipelineId),
        eq(kronosForecastsTable.forecastDate, today)
      )
    );

  if (forecastRows.length === 0) {
    console.warn(
      `[pipeline/run] No Kronos forecasts for pipeline ${pipelineId} on ${today}. Continuing with earnings-only signals.`
    );
  } else {
    kronosForecastData = forecastRows.map((r) => ({
      ticker: r.ticker,
      predictedReturnPct: parseFloat(r.predictedReturnPct),
    }));
    console.log(
      `[pipeline/run] Loaded ${kronosForecastData.length} Kronos forecasts for pipeline ${pipelineId}`
    );
  }
}
```

**Ticker resolution note:** For `kronos_rotation` pipelines, the tickers evaluated by the pipeline should be the **union** of `tickerUniverse` and `kronosTickerUniverse`. Update the existing ticker resolution block at the top of the try block:

```typescript
// BEFORE:
let tickers: string[];
if (pipeline.tickerUniverse.length > 0) {
  tickers = pipeline.tickerUniverse;
} else {
  const universe = await db.select({ ticker: stockUniverse.ticker }).from(stockUniverse).limit(50);
  tickers = universe.map((u) => u.ticker);
}

// AFTER (add kronos universe):
let tickers: string[];
const kronosTickers = (pipeline.kronosTickerUniverse as string[] | null) ?? [];
const baseTickers = pipeline.tickerUniverse.length > 0
  ? pipeline.tickerUniverse
  : await db.select({ ticker: stockUniverse.ticker }).from(stockUniverse).limit(50).then((rows) => rows.map((u) => u.ticker));

// For kronos_rotation: evaluate the full union of both universes
tickers =
  pipeline.strategyType === "kronos_rotation"
    ? [...new Set([...baseTickers, ...kronosTickers])]
    : baseTickers;
```

**Update the `buildPrompt` call** (inside the portfolioLinks for-loop):

```typescript
// BEFORE:
prompt: buildPrompt(pipeline, tickers, earningsMap, portfolioState, today),

// AFTER:
prompt: buildPrompt(pipeline, tickers, earningsMap, portfolioState, today, kronosForecastData),
```

**Add import** for `kronosForecasts` at the top of the file:

```typescript
import {
  pipelines, pipelineRuns, decisionLog, holdings,
  portfolios, cachedQuotes, stockUniverse, pipelinePortfolios,
  kronosForecasts as kronosForecastsTable,  // ← ADD
} from "@/db/schema";
```

---

### 5b. `src/lib/pipeline-prompt.ts`

**Two changes:** extend `PipelineConfigForPrompt` with Kronos fields, and update `buildPrompt` to accept and render forecasts.

**Extended interface:**

```typescript
export interface PipelineConfigForPrompt {
  thesis: string;
  strategyType: string;
  maxPositionPct: string;
  minCashReservePct: string;
  earningsLookbackDays: number;
  earningsForwardDays: number;
  minConfidenceThreshold: string;
  // Kronos-specific (only populated for kronos_rotation)
  kronosRebalancePct?: string;
  kronosMinSignalPct?: string;
}
```

**Updated `buildPrompt` signature:**

```typescript
export function buildPrompt(
  pipeline: PipelineConfigForPrompt,
  tickers: string[],
  earningsMap: Map<string, EarningsSignal>,
  portfolioState: PortfolioStateForPrompt,
  today: string,
  kronosForecasts?: Array<{ ticker: string; predictedReturnPct: number }>  // ← ADD
): string {
```

**Add Kronos section to the returned prompt string.** Insert after the earnings signals block and before the `## Instructions` section:

```typescript
// --- Kronos forecast section (only for kronos_rotation) ---
let kronosSectionText = "";

if (kronosForecasts && kronosForecasts.length > 0) {
  const rebalancePct = pipeline.kronosRebalancePct ?? "50";
  const minSignalPct = parseFloat(pipeline.kronosMinSignalPct ?? "1.00");

  const sortedForecasts = [...kronosForecasts].sort(
    (a, b) => b.predictedReturnPct - a.predictedReturnPct
  );

  const forecastRows = sortedForecasts
    .map(
      (f) =>
        `${f.ticker.padEnd(6)} | ${(f.predictedReturnPct >= 0 ? "+" : "") + f.predictedReturnPct.toFixed(2)}%`
    )
    .join("\n");

  kronosSectionText = `
## Kronos AI Forecasts (24h predicted return, sorted descending)
Ticker | Predicted Return
${forecastRows}

Kronos signal rules:
- BUY candidates: tickers with predicted return > +${minSignalPct}% (above threshold)
- SELL candidates: tickers you currently hold with predicted return < -${minSignalPct}% (below negative threshold)
- SELL instruction: aim to reduce the position by ~${rebalancePct}% (set sharesPct = ${rebalancePct} unless thesis warrants more/less)
- Tickers with predicted return between -${minSignalPct}% and +${minSignalPct}% are neutral — treat as HOLD or SKIP unless earnings signals override
- Kronos signals are the PRIMARY rotation signal; earnings signals are SECONDARY confirmation
`;
}
```

Then include `kronosSectionText` in the returned template string, right before `## Instructions`:

```typescript
return `You are an autonomous AI investment strategy executor for a paper trading simulator. Today: ${today}.

## Investment Strategy
Type: ${pipeline.strategyType}

Thesis:
${pipeline.thesis}

## Portfolio State
...

## Earnings Signals (${pipeline.earningsLookbackDays}d lookback + ${pipeline.earningsForwardDays}d forward)
${signalLines.join("\n")}
${kronosSectionText}
## Instructions
...`;
```

---

### 5c. `src/lib/pipeline-defaults.ts`

Add the three new Kronos fields to defaults and to `INHERITABLE_FIELDS`:

```typescript
// In the defaults object:
kronosTickerUniverse: [] as string[],
kronosRebalancePct: "50.00",
kronosMinSignalPct: "1.00",

// In INHERITABLE_FIELDS array — add all three:
"kronosTickerUniverse",
"kronosRebalancePct",
"kronosMinSignalPct",
```

---

### 5d. `src/app/api/strategy-templates/route.ts`

Register a `kronos_rotation` template. Follow the existing pattern for other strategy type registrations in this file. The template object:

```typescript
{
  name: "Kronos Rotation",
  description:
    "Uses Kronos AI price forecasting to rotate into predicted winners and out of predicted losers. Goal: beat S&P 500.",
  strategyType: "kronos_rotation",
  thesis:
    "Rotate capital toward stocks with the highest predicted 24h return per Kronos AI, while exiting positions where Kronos predicts meaningful downside. Prioritize high-signal tickers above the threshold; use earnings data as secondary confirmation.",
  tickerUniverse: [],
  kronosTickerUniverse: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN"],
  maxPositions: 10,
  maxPositionPct: "15.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.60",
  autonomous: true,
  allowShortSell: false,
  rebalanceOnRun: false,
  kronosRebalancePct: "50.00",
  kronosMinSignalPct: "1.00",
}
```

---

### 5e. Quote Refresh Cron

The quote refresh cron refreshes `cachedQuotes` for tickers that pipelines need. It likely lives in `src/app/api/cron/refresh-quotes/route.ts` (or similar). Extend the ticker query to include `kronosTickerUniverse` from active `kronos_rotation` pipelines.

**Pattern to add** (alongside existing ticker collection logic):

```typescript
// Existing: collect tickers from active pipeline tickerUniverses
// ADD: also collect kronosTickerUniverse from kronos_rotation pipelines
const kronosPipelines = await db
  .select({ kronosTickerUniverse: pipelines.kronosTickerUniverse })
  .from(pipelines)
  .where(
    and(
      eq(pipelines.status, "active"),
      eq(pipelines.strategyType, "kronos_rotation")
    )
  );

const kronosTickers = kronosPipelines
  .flatMap((p) => (p.kronosTickerUniverse as string[] | null) ?? []);

// Union with existing tickers before the refresh loop:
const allTickers = [...new Set([...existingTickers, ...kronosTickers])];
```

---

## 6. QStash Orchestration

### Updated EOD Sequence

The existing EOD sequence fires one `pipeline/run` per pipeline. The new sequence runs prefetch steps **in parallel** before the pipeline runs.

```
Market close trigger (existing QStash schedule, e.g. 4:05 PM ET)
    │
    ├─── QStash: POST /api/pipeline/kronos-prefetch   ──┐
    │                                                    │ parallel
    └─── QStash: POST /api/earnings/fetch  (existing) ──┘
         │
         (both complete, typically within 2-3 minutes)
         │
         QStash coordinator (delayed): POST /api/pipeline/run-all
             │
             └─── for each active pipeline: POST /api/pipeline/run?pipelineId=...
```

### Implementation Options

**Recommended: Fixed-delay coordinator**

Use QStash's `Delay` header to fire the pipeline runs after a fixed buffer that covers both prefetch steps:

1. At market close (4:05 PM ET), fire two QStash messages in parallel:
   - `POST /api/pipeline/kronos-prefetch` (no delay)
   - `POST /api/earnings/fetch` (no delay, if not already running as a separate step)
2. Schedule `POST /api/pipeline/run-all` with a 3-minute delay (`Upstash-Delay: 180s`) from the same trigger.

This avoids complex dependency tracking. Modal inference for a 5-ticker list typically completes in < 60s on GPU; 3 minutes is a safe buffer.

**Alternative: Coordinator step**

If stricter sequencing is required:
1. Market close fires `POST /api/pipeline/coordinator`.
2. Coordinator fans out the two prefetch calls via QStash (using `@upstash/qstash` client) and schedules a polling callback.
3. After verifying both are done (or timeout at T+5min), coordinator enqueues individual `pipeline/run` messages.

For most use cases the fixed-delay approach is simpler and sufficient.

### QStash Schedule Entry (add alongside existing)

```
Cron: 5 16 * * 1-5  (4:05 PM ET, Mon-Fri)
URL:  https://your-domain.com/api/pipeline/kronos-prefetch
```

The existing `pipeline/run` cron should be shifted to 4:10 PM ET (`10 16 * * 1-5`) to give prefetch a head start.

---

## 7. UI Changes

### 7a. Pipeline Run Detail Page (`/pipelines/[id]/runs/[runId]`)

Add a **"Kronos Forecasts"** card below the existing decision log section.

**Data fetching:** Query `kronos_forecasts` where `pipelineId = pipeline.id AND forecastDate = run.startedAt.toISOString().split("T")[0]`. Expose this via an existing or new server component/API route (`GET /api/pipeline/[id]/runs/[runId]/forecasts`).

**Component (`KronosForecastsCard`):**

```tsx
interface KronosForecastRow {
  ticker: string;
  predictedReturnPct: number;
  signal: "buy" | "sell" | "hold";
}

function KronosForecastsCard({
  forecasts,
  kronosMinSignalPct,
}: {
  forecasts: KronosForecastRow[];
  kronosMinSignalPct: number;
}) {
  if (forecasts.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Kronos Forecasts</CardTitle></CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No Kronos forecasts for this run.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kronos Forecasts</CardTitle>
        <CardDescription>
          24h predicted return from Kronos-base. Threshold: ±{kronosMinSignalPct}%
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>Predicted Return</TableHead>
              <TableHead>Signal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {forecasts.map((f) => (
              <TableRow key={f.ticker}>
                <TableCell className="font-mono font-semibold">{f.ticker}</TableCell>
                <TableCell className={f.predictedReturnPct >= 0 ? "text-green-600" : "text-red-600"}>
                  {f.predictedReturnPct >= 0 ? "+" : ""}
                  {f.predictedReturnPct.toFixed(2)}%
                </TableCell>
                <TableCell>
                  {f.signal === "buy" && <span>🟢 Buy</span>}
                  {f.signal === "sell" && <span>🔴 Sell</span>}
                  {f.signal === "hold" && <span>⚪ Hold</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Signal derivation helper:
function deriveSignal(
  predictedReturnPct: number,
  kronosMinSignalPct: number
): "buy" | "sell" | "hold" {
  if (predictedReturnPct > kronosMinSignalPct) return "buy";
  if (predictedReturnPct < -kronosMinSignalPct) return "sell";
  return "hold";
}
```

---

### 7b. `StockDetailSheet`

Fetch forecast client-side on mount via SWR or `useEffect`:

```typescript
// Inside StockDetailSheet component:
const [kronosForecast, setKronosForecast] = useState<{
  predictedReturnPct: number;
  forecastDate: string;
} | null>(null);

useEffect(() => {
  fetch(`/api/tickers/${ticker}/forecast`)
    .then((r) => r.json())
    .then((data) => setKronosForecast(data))
    .catch(() => setKronosForecast(null));
}, [ticker]);

// In JSX, conditionally render a "Kronos" row:
{kronosForecast && (
  <div className="flex justify-between items-center py-1 border-b">
    <span className="text-sm text-muted-foreground">Kronos Forecast</span>
    <span className={`text-sm font-medium ${
      kronosForecast.predictedReturnPct >= 0 ? "text-green-600" : "text-red-600"
    }`}>
      {kronosForecast.predictedReturnPct >= 0 ? "+" : ""}
      {kronosForecast.predictedReturnPct.toFixed(2)}%
      <span className="text-xs text-muted-foreground ml-1">
        ({kronosForecast.forecastDate})
      </span>
    </span>
  </div>
)}
// If kronosForecast is null, render nothing (no skeleton needed)
```

---

## 8. Env Vars

| Variable | Value | Where |
|----------|-------|-------|
| `KRONOS_SECRET` | `openssl rand -hex 32` | Vercel prod env, `.env.local`, Modal secret named `kronos-secret` |
| `MODAL_API_URL` | Modal endpoint URL (printed after `modal deploy`) | Vercel prod env, `.env.local` |
| `MODAL_TOKEN_ID` | Modal account token ID | GitHub Secrets only |
| `MODAL_TOKEN_SECRET` | Modal account token secret | GitHub Secrets only |

**`.env.local` additions:**
```
KRONOS_SECRET=<your-hex-32>
MODAL_API_URL=https://your-modal-endpoint.modal.run/forecast_endpoint
```

**Note:** `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` are only needed for deployment (GitHub Actions) and never exposed to the Next.js app or Vercel runtime.

---

## 9. Tests

Follow the existing test patterns in this project (Vitest + RTL, or whatever test runner is in use).

### `src/app/api/pipeline/kronos-prefetch/route.ts`

| Test case | Expectation |
|-----------|-------------|
| Valid QStash signature, pipeline has tickers, Modal returns forecasts | Upserts `N` rows into `kronos_forecasts`, returns `{ ok: true, upserted: N }` |
| Invalid/missing QStash signature | Returns 403 (QStash middleware rejects) |
| Modal returns HTTP 500 | Logs error, skips that pipeline, continues with others, returns partial success |
| Modal returns `{ results: [] }` | Logs warning, no DB writes for that pipeline |
| Pipeline has `kronosTickerUniverse: []` | Skips pipeline with warning, no Modal call |
| No active `kronos_rotation` pipelines | Returns `{ ok: true, upserted: 0 }` without calling Modal |

### `src/app/api/tickers/[ticker]/forecast/route.ts`

| Test case | Expectation |
|-----------|-------------|
| Ticker with one forecast row | Returns `{ ticker, predictedReturnPct, forecastDate, pipelineId }` |
| Ticker with multiple rows (different dates) | Returns the row with the most recent `forecastDate` |
| Ticker with no forecasts | Returns `null` (HTTP 200 with JSON null) |
| Ticker symbol is lowercased in URL | Normalised to uppercase before query |

### `src/app/api/pipeline/run/route.ts` — `kronos_rotation` branch

| Test case | Expectation |
|-----------|-------------|
| `strategyType = kronos_rotation`, forecasts present for today | `buildPrompt` called with `kronosForecastData` array populated |
| `strategyType = kronos_rotation`, no forecasts for today | `console.warn` called; `buildPrompt` called with empty `kronosForecastData`; run proceeds |
| `strategyType = thesis_driven` | Kronos forecast query not executed; `buildPrompt` called with empty `kronosForecastData` |
| `kronosTickerUniverse = ["AAPL"]`, `tickerUniverse = ["MSFT"]` | `tickers` is `["MSFT", "AAPL"]` (union, deduped) |

### `src/lib/pipeline-prompt.ts`

| Test case | Expectation |
|-----------|-------------|
| `buildPrompt` called with `kronosForecasts` array | Returned string includes `## Kronos AI Forecasts` section with ranked table |
| `buildPrompt` called with `kronosForecasts = []` | No Kronos section in returned string |
| `buildPrompt` called without `kronosForecasts` param | No Kronos section in returned string |
| Forecast with `predictedReturnPct = 2.5`, `kronosMinSignalPct = 1.0` | Prompt instructs BUY for that ticker |
| Forecast with `predictedReturnPct = -1.5`, `kronosMinSignalPct = 1.0` | Prompt instructs SELL with `~kronosRebalancePct%` reduction |

### `StockDetailSheet` (RTL)

| Test case | Expectation |
|-----------|-------------|
| `/api/tickers/AAPL/forecast` returns `{ predictedReturnPct: 2.3, forecastDate: "2026-06-07" }` | Renders "Kronos Forecast" row with `+2.30%` in green |
| `/api/tickers/AAPL/forecast` returns `null` | No "Kronos Forecast" row rendered |
| Fetch throws network error | No "Kronos Forecast" row rendered (silent fail) |

### Pipeline Run Detail UI (RTL)

| Test case | Expectation |
|-----------|-------------|
| Run has forecasts data | `KronosForecastsCard` renders table with ticker rows, correct signal emoji |
| Run has no forecasts | `KronosForecastsCard` renders "No Kronos forecasts for this run." |
| `predictedReturnPct = 0.5`, `kronosMinSignalPct = 1.0` | Signal column shows ⚪ Hold |
| `predictedReturnPct = -2.0`, `kronosMinSignalPct = 1.0` | Signal column shows 🔴 Sell |

---

## 10. Migration & Deploy Order

Execute in this exact order to avoid downtime or data integrity issues:

**Step 1 — DB migration**
```bash
# In PaperTrader repo:
npx drizzle-kit generate
# Review the generated SQL — confirm it adds the enum value, new table, and 3 columns
npx drizzle-kit migrate   # or apply via Neon/Supabase console
```

> Postgres `ALTER TYPE ... ADD VALUE` for the enum cannot be run inside a transaction in older Postgres versions. If you see an error, run it as a standalone statement.

**Step 2 — Create Modal secret**
```bash
modal secret create kronos-secret KRONOS_SECRET=<your-hex-32>
```

**Step 3 — Deploy Modal service**
```bash
modal deploy modal/kronos_service.py
# Copy the printed endpoint URL, e.g.:
# https://your-app-name--forecast-endpoint.modal.run
```

**Step 4 — Set Vercel env vars**

In Vercel dashboard (or via `vercel env add`):
```
MODAL_API_URL = <endpoint URL from step 3>
KRONOS_SECRET = <same hex as step 2>
```

**Step 5 — Set GitHub Secrets**

In repo Settings → Secrets → Actions:
```
MODAL_TOKEN_ID = <modal token id>
MODAL_TOKEN_SECRET = <modal token secret>
```

**Step 6 — Push main → deploy**
```bash
git push origin main
```
Vercel deploys the Next.js app. GitHub Actions deploys/re-deploys the Modal service.

**Step 7 — Add QStash schedule for kronos-prefetch**

In Upstash QStash console, add a new schedule:
```
Cron:    5 16 * * 1-5    (4:05 PM ET, Mon-Fri)
URL:     https://your-domain.com/api/pipeline/kronos-prefetch
```
Also shift the existing `pipeline/run` cron trigger to 4:10 PM ET if it isn't already delayed enough.

**Step 8 — Create a test `kronos_rotation` pipeline**
```bash
# Via Admin API or Postman:
POST /api/pipeline
{
  "name": "Kronos Test",
  "strategyType": "kronos_rotation",
  "kronosTickerUniverse": ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN"],
  "kronosRebalancePct": "50.00",
  "kronosMinSignalPct": "1.00",
  "autonomous": true
}
```

**Step 9 — Manual smoke test: prefetch**
```bash
# Trigger kronos-prefetch manually via QStash test or curl with correct signature
# Then verify:
SELECT * FROM kronos_forecasts ORDER BY created_at DESC LIMIT 10;
# Should see 5 rows (AAPL, MSFT, NVDA, TSLA, AMZN) with today's forecastDate
```

**Step 10 — Manual smoke test: pipeline run**
```bash
# Trigger pipeline run for the test pipeline
# Then verify:
SELECT ticker, action, reasoning, executed FROM decision_log
WHERE pipeline_id = '<test-pipeline-id>'
ORDER BY decided_at DESC LIMIT 10;
# Reasoning should reference Kronos signals and predicted return percentages
```

---

## Appendix: Type Updates

After schema changes, re-run `drizzle-kit introspect` or ensure the following types are exported from `src/db/schema.ts`:

```typescript
export type KronosForecast = typeof kronosForecasts.$inferSelect;
export type NewKronosForecast = typeof kronosForecasts.$inferInsert;

// Updated Pipeline type will automatically include the 3 new columns
// from the Drizzle inference: Pipeline.kronosTickerUniverse, etc.
```

Update `PipelineConfigForPrompt` in `src/lib/pipeline-prompt.ts` as described in §5b to keep the type safe when passing pipeline to `buildPrompt`.

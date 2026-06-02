# AI Pipeline System — Developer Spec

**Version:** 1.0  
**Date:** 2026-06-01  
**Status:** Ready for implementation  

---

## Overview

This spec defines an autonomous AI-driven investment pipeline system built into PaperTrader. Each pipeline wraps a strategy (thesis + config), is assigned to one or more portfolios, and runs on a daily EOD schedule. At runtime, the pipeline fetches earnings signals, reasons about each ticker via an LLM, and executes approved trades through the existing `/api/trade` route.

This is a **paper trading simulator** — no real money involved. The system is built for strategy validation.

---

## 1. Database Schema

Add the following to `src/db/schema.ts`.

### New Enums

```typescript
export const pipelineStatusEnum = pgEnum("pipeline_status", [
  "active",
  "paused",
  "archived",
]);

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const decisionActionEnum = pgEnum("decision_action", [
  "BUY",
  "SELL",
  "HOLD",
  "SKIP",
]);

export const strategyTypeEnum = pgEnum("strategy_type", [
  "thesis_driven",     // natural language thesis + config fields
  "signal_driven",     // pure signal-reactive agent
  // TODO: hypothesis_tester strategy type — planned enhancement, not in this release.
  // Requires distinct prompt logic and result evaluation framework.
]);
```

### `strategy_templates`

Reusable strategy definitions owned by a user. Pipelines inherit from these.

```typescript
export const strategyTemplates = pgTable("strategy_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  strategyType: strategyTypeEnum("strategy_type").notNull().default("thesis_driven"),

  // Natural language thesis (used verbatim in AI prompt)
  thesis: text("thesis").notNull(),

  // Structured config fields
  // Empty tickerUniverse = let AI decide from stock_universe table
  tickerUniverse: text("ticker_universe").array().notNull().default([]),

  maxPositions: integer("max_positions").default(10).notNull(),
  maxPositionPct: decimal("max_position_pct", { precision: 5, scale: 2 }).default("10.00").notNull(),
  // Max % of portfolio value in any single position

  minCashReservePct: decimal("min_cash_reserve_pct", { precision: 5, scale: 2 }).default("5.00").notNull(),
  // AI will never deploy below this cash floor

  earningsLookbackDays: integer("earnings_lookback_days").default(3).notNull(),
  // Earnings events from past N days are considered signals

  earningsForwardDays: integer("earnings_forward_days").default(7).notNull(),
  // Upcoming earnings within N days trigger pre-positioning signals

  minConfidenceThreshold: decimal("min_confidence_threshold", { precision: 4, scale: 2 }).default("0.65").notNull(),
  // AI decisions below this confidence are auto-skipped

  autonomous: boolean("autonomous").default(true).notNull(),
  // If false, pipeline generates decisions but does NOT execute trades

  allowShortSell: boolean("allow_short_sell").default(false).notNull(),
  // Reserved for future use

  rebalanceOnRun: boolean("rebalance_on_run").default(false).notNull(),
  // TODO: Reserved — not enforced in v1. Planned: AI may sell existing positions to fund new ones.

  hypothesisConfig: text("hypothesis_config"),
  // JSON string: { hypothesis, controlGroup, targetMetric, durationDays }
  // Only used when strategyType = 'hypothesis_tester'

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### `pipelines`

Pipeline instances. Inherit from a template, can override any config field.

```typescript
export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  templateId: uuid("template_id")
    .references(() => strategyTemplates.id, { onDelete: "set null" }),
  // null = standalone pipeline (no template inheritance)

  name: text("name").notNull(),
  status: pipelineStatusEnum("status").notNull().default("active"),

  // Resolved config — effective values after template inheritance.
  // Written at create/update time; no runtime resolution needed.
  thesis: text("thesis").notNull(),
  strategyType: strategyTypeEnum("strategy_type").notNull().default("thesis_driven"),
  tickerUniverse: text("ticker_universe").array().notNull().default([]),
  maxPositions: integer("max_positions").default(10).notNull(),
  maxPositionPct: decimal("max_position_pct", { precision: 5, scale: 2 }).default("10.00").notNull(),
  minCashReservePct: decimal("min_cash_reserve_pct", { precision: 5, scale: 2 }).default("5.00").notNull(),
  earningsLookbackDays: integer("earnings_lookback_days").default(3).notNull(),
  earningsForwardDays: integer("earnings_forward_days").default(7).notNull(),
  minConfidenceThreshold: decimal("min_confidence_threshold", { precision: 4, scale: 2 }).default("0.65").notNull(),
  autonomous: boolean("autonomous").default(true).notNull(),
  allowShortSell: boolean("allow_short_sell").default(false).notNull(),
  rebalanceOnRun: boolean("rebalance_on_run").default(false).notNull(),
  // TODO: Reserved — not enforced in v1. Planned: AI may sell existing positions to fund new ones.
  hypothesisConfig: text("hypothesis_config"),

  // JSON array of field names explicitly overridden from the template.
  // Used by UI to show what's been customized vs inherited.
  configOverrides: text("config_overrides").array().notNull().default([]),

  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

**Inheritance model:** Template fields are copied into pipeline columns at create time. `configOverrides` tracks which fields the user customized. When a template is updated, the UI can offer "sync to template" which re-applies template defaults for non-overridden fields.

### `pipeline_portfolios`

Many-to-many: pipelines ↔ portfolios with allocation percentage.

```typescript
export const pipelinePortfolios = pgTable(
  "pipeline_portfolios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pipelineId: uuid("pipeline_id")
      .references(() => pipelines.id, { onDelete: "cascade" })
      .notNull(),
    portfolioId: uuid("portfolio_id")
      .references(() => portfolios.id, { onDelete: "cascade" })
      .notNull(),
    allocationPct: decimal("allocation_pct", { precision: 5, scale: 2 }).default("100.00").notNull(),
    // % of portfolio cash the pipeline may deploy. 100 = full access.
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique().on(t.pipelineId, t.portfolioId),
  })
);
```

### `pipeline_runs`

One record per pipeline execution attempt.

```typescript
export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id")
    .references(() => pipelines.id, { onDelete: "cascade" })
    .notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull().default("cron"),
  // 'cron' | 'manual' | 'qstash'

  tickersEvaluated: integer("tickers_evaluated").default(0).notNull(),
  tradesExecuted: integer("trades_executed").default(0).notNull(),
  tradesSkipped: integer("trades_skipped").default(0).notNull(),
  tradesFailed: integer("trades_failed").default(0).notNull(),

  errorMessage: text("error_message"),
  // Top-level error if the run failed before executing any trades

  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
});
```

### `decision_log`

Per-ticker AI decision record. One row per ticker per run per portfolio.

```typescript
export const decisionLog = pgTable("decision_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .references(() => pipelineRuns.id, { onDelete: "cascade" })
    .notNull(),
  pipelineId: uuid("pipeline_id")
    .references(() => pipelines.id, { onDelete: "cascade" })
    .notNull(),
  portfolioId: uuid("portfolio_id")
    .references(() => portfolios.id, { onDelete: "set null" }),

  ticker: text("ticker").notNull(),
  action: decisionActionEnum("action").notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 2 }),
  // 0.00-1.00 as returned by AI

  shares: decimal("shares", { precision: 15, scale: 6 }),
  // shares AI recommended (null for HOLD/SKIP)
  priceAtDecision: decimal("price_at_decision", { precision: 15, scale: 4 }),

  reasoning: text("reasoning").notNull(),
  // Full AI reasoning string for this decision

  signalSummary: text("signal_summary"),
  // JSON string: { epsBeats, epsEstimate, epsActual, revisionDirection, daysToEarnings, etc. }

  executed: boolean("executed").default(false).notNull(),
  // Whether trade was actually sent to /api/trade
  executionError: text("execution_error"),
  // Reason trade was not executed: 'confidence_below_threshold' | 'insufficient_cash' |
  // 'max_position_size_reached' | 'no_holding' | 'no_price_data' | 'pipeline_not_autonomous' | <api error>

  decidedAt: timestamp("decided_at").defaultNow().notNull(),
});
```

### `earnings_signals`

Cached earnings data to avoid repeated API calls within a run window.

```typescript
export const earningsSignals = pgTable(
  "earnings_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    reportDate: text("report_date").notNull(), // 'YYYY-MM-DD'
    reportTime: text("report_time"), // 'bmo' | 'amc' | null

    // Actuals (populated after report)
    epsActual: decimal("eps_actual", { precision: 10, scale: 4 }),
    epsEstimate: decimal("eps_estimate", { precision: 10, scale: 4 }),
    epsBeat: boolean("eps_beat"),
    epsSurprisePct: decimal("eps_surprise_pct", { precision: 8, scale: 4 }),

    analystRevisionDirection: text("analyst_revision_direction"),
    // 'up' | 'down' | 'neutral' | null (net analyst revisions over last 30 days)

    revenueActual: decimal("revenue_actual", { precision: 20, scale: 2 }),
    revenueEstimate: decimal("revenue_estimate", { precision: 20, scale: 2 }),
    revenueBeat: boolean("revenue_beat"),

    rawData: text("raw_data"),
    // Full JSON from Finnhub for debugging

    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    // TTL: past earnings expire in 7 days; future earnings expire at reportDate+1
  },
  (t) => ({
    tickerDateUniq: unique().on(t.ticker, t.reportDate),
  })
);
```

### Drizzle Relations (additions to schema.ts)

```typescript
export const strategyTemplatesRelations = relations(strategyTemplates, ({ one, many }) => ({
  user: one(users, { fields: [strategyTemplates.userId], references: [users.id] }),
  pipelines: many(pipelines),
}));

export const pipelinesRelations = relations(pipelines, ({ one, many }) => ({
  user: one(users, { fields: [pipelines.userId], references: [users.id] }),
  template: one(strategyTemplates, { fields: [pipelines.templateId], references: [strategyTemplates.id] }),
  portfolioLinks: many(pipelinePortfolios),
  runs: many(pipelineRuns),
  decisions: many(decisionLog),
}));

export const pipelinePortfoliosRelations = relations(pipelinePortfolios, ({ one }) => ({
  pipeline: one(pipelines, { fields: [pipelinePortfolios.pipelineId], references: [pipelines.id] }),
  portfolio: one(portfolios, { fields: [pipelinePortfolios.portfolioId], references: [portfolios.id] }),
}));

export const pipelineRunsRelations = relations(pipelineRuns, ({ one, many }) => ({
  pipeline: one(pipelines, { fields: [pipelineRuns.pipelineId], references: [pipelines.id] }),
  decisions: many(decisionLog),
}));

export const decisionLogRelations = relations(decisionLog, ({ one }) => ({
  run: one(pipelineRuns, { fields: [decisionLog.runId], references: [pipelineRuns.id] }),
  pipeline: one(pipelines, { fields: [decisionLog.pipelineId], references: [pipelines.id] }),
  portfolio: one(portfolios, { fields: [decisionLog.portfolioId], references: [portfolios.id] }),
}));

// Also add to portfoliosRelations: pipelineLinks: many(pipelinePortfolios)
// Also add to usersRelations: strategyTemplates: many(strategyTemplates), pipelines: many(pipelines)
```

---

## 2. New Library: `src/lib/earnings.ts`

```typescript
import { getFinnhubClient } from "./finnhub";
import yahooFinance from "yahoo-finance2";
import { db } from "@/db";
import { earningsSignals } from "@/db/schema";
import { and, gte, lte, eq, inArray } from "drizzle-orm";

export interface EarningsSignal {
  ticker: string;
  reportDate: string;
  reportTime: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsBeat: boolean | null;
  epsSurprisePct: number | null;
  analystRevisionDirection: string | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueBeat: boolean | null;
}

/**
 * Fetch earnings signals for a list of tickers.
 * Checks DB cache first; calls Finnhub only for misses.
 * Rate-limit safe: 200ms delay between Finnhub calls (enforces <60/min).
 */
export async function fetchEarningsSignals(
  tickers: string[],
  lookbackDays: number,
  forwardDays: number
): Promise<Map<string, EarningsSignal>> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - lookbackDays * 86400000);
  const toDate = new Date(now.getTime() + forwardDays * 86400000);
  const fromStr = toDateStr(fromDate);
  const toStr = toDateStr(toDate);

  const result = new Map<string, EarningsSignal>();

  // Batch cache lookup — single query instead of per-ticker SELECTs
  const cachedRows = await db
    .select()
    .from(earningsSignals)
    .where(
      and(
        inArray(earningsSignals.ticker, tickers),
        gte(earningsSignals.reportDate, fromStr),
        lte(earningsSignals.reportDate, toStr),
        gte(earningsSignals.expiresAt, now)
      )
    );

  const cachedTickers = new Set<string>();
  for (const row of cachedRows) {
    result.set(row.ticker, mapRow(row));
    cachedTickers.add(row.ticker);
  }

  const cacheMisses = tickers.filter((t) => !cachedTickers.has(t));

  const client = getFinnhubClient();
  for (const ticker of cacheMisses) {
    try {
      const data = await fetchFinnhubEarnings(client, ticker, fromStr, toStr);
      if (data) {
        // Enrich with analyst revision direction from yahoo-finance2
        data.analystRevisionDirection = await fetchAnalystRevisionDirection(ticker);
        await upsertEarningsSignal(ticker, data);
        result.set(ticker, data);
      }
      await sleep(200); // Respect 60/min rate limit
    } catch (err) {
      console.error(`[earnings] Failed to fetch ${ticker}:`, err);
    }
  }

  return result;
}

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFinnhubEarnings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ticker: string,
  from: string,
  to: string
): Promise<EarningsSignal | null> {
  return new Promise((resolve) => {
    client.earningsCalendar(
      { from, to, symbol: ticker, international: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error: unknown, data: any) => {
        if (error || !data?.earningsCalendar?.length) {
          resolve(null);
          return;
        }
        const e = data.earningsCalendar[0];
        const epsActual = e.epsActual ?? null;
        const epsEstimate = e.epsEstimate ?? null;
        const epsBeat =
          epsActual !== null && epsEstimate !== null ? epsActual >= epsEstimate : null;
        const epsSurprisePct =
          epsBeat !== null && epsEstimate !== 0 && epsEstimate !== null
            ? ((epsActual! - epsEstimate!) / Math.abs(epsEstimate!)) * 100
            : null;

        // Fetch analyst revision direction from yahoo-finance2 (outside the Finnhub callback)
        // Set to null initially; resolved asynchronously below.
        resolve({
          ticker,
          reportDate: e.date,
          reportTime: e.hour ?? null,
          epsActual,
          epsEstimate,
          epsBeat,
          epsSurprisePct,
          analystRevisionDirection: null, // resolved by fetchAnalystRevisionDirection
          revenueActual: e.revenueActual ?? null,
          revenueEstimate: e.revenueEstimate ?? null,
          revenueBeat:
            e.revenueActual !== null && e.revenueEstimate !== null
              ? e.revenueActual >= e.revenueEstimate
              : null,
        });
      }
    );
  });
}

/**
 * Determine analyst revision direction for a ticker using yahoo-finance2.
 * Counts upgrades vs downgrades over the last 30 days and returns 'up' | 'down' | 'neutral'.
 */
async function fetchAnalystRevisionDirection(ticker: string): Promise<"up" | "down" | "neutral"> {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ["upgradeDowngradeHistory"],
    });
    const history = result.upgradeDowngradeHistory?.history ?? [];
    const cutoff = Date.now() - 30 * 86400000;
    const recent = history.filter((item: { epochGradeDate: number }) => item.epochGradeDate * 1000 >= cutoff);
    let upgrades = 0;
    let downgrades = 0;
    for (const item of recent) {
      const action = (item.action ?? "").toLowerCase();
      if (action === "up" || action === "upgrade") upgrades++;
      else if (action === "down" || action === "downgrade") downgrades++;
    }
    if (upgrades > downgrades) return "up";
    if (downgrades > upgrades) return "down";
    return "neutral";
  } catch {
    return "neutral";
  }
}

async function upsertEarningsSignal(ticker: string, signal: EarningsSignal): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db
    .insert(earningsSignals)
    .values({
      ticker: signal.ticker,
      reportDate: signal.reportDate,
      reportTime: signal.reportTime,
      epsActual: signal.epsActual !== null ? String(signal.epsActual) : null,
      epsEstimate: signal.epsEstimate !== null ? String(signal.epsEstimate) : null,
      epsBeat: signal.epsBeat,
      epsSurprisePct: signal.epsSurprisePct !== null ? String(signal.epsSurprisePct) : null,
      analystRevisionDirection: signal.analystRevisionDirection,
      revenueActual: signal.revenueActual !== null ? String(signal.revenueActual) : null,
      revenueEstimate: signal.revenueEstimate !== null ? String(signal.revenueEstimate) : null,
      revenueBeat: signal.revenueBeat,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [earningsSignals.ticker, earningsSignals.reportDate],
      set: {
        epsActual: signal.epsActual !== null ? String(signal.epsActual) : null,
        epsEstimate: signal.epsEstimate !== null ? String(signal.epsEstimate) : null,
        epsBeat: signal.epsBeat,
        epsSurprisePct: signal.epsSurprisePct !== null ? String(signal.epsSurprisePct) : null,
        analystRevisionDirection: signal.analystRevisionDirection,
        revenueActual: signal.revenueActual !== null ? String(signal.revenueActual) : null,
        revenueEstimate: signal.revenueEstimate !== null ? String(signal.revenueEstimate) : null,
        revenueBeat: signal.revenueBeat,
        reportTime: signal.reportTime,
        fetchedAt: new Date(),
        expiresAt,
      },
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): EarningsSignal {
  return {
    ticker: row.ticker,
    reportDate: row.reportDate,
    reportTime: row.reportTime,
    epsActual: row.epsActual !== null ? parseFloat(row.epsActual) : null,
    epsEstimate: row.epsEstimate !== null ? parseFloat(row.epsEstimate) : null,
    epsBeat: row.epsBeat,
    epsSurprisePct: row.epsSurprisePct !== null ? parseFloat(row.epsSurprisePct) : null,
    analystRevisionDirection: row.analystRevisionDirection,
    revenueActual: row.revenueActual !== null ? parseFloat(row.revenueActual) : null,
    revenueEstimate: row.revenueEstimate !== null ? parseFloat(row.revenueEstimate) : null,
    revenueBeat: row.revenueBeat,
  };
}
```

---

## 3. New Library: `src/lib/pipeline-prompt.ts`

```typescript
import { z } from "zod";
import type { EarningsSignal } from "./earnings";

export const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      ticker: z.string(),
      action: z.enum(["BUY", "SELL", "HOLD", "SKIP"]),
      confidence: z.number().min(0).max(1),
      sharesPct: z.number().min(0).max(100).nullable(),
      // BUY: % of deployable cash to allocate (e.g., 10 = 10% of available cash)
      // SELL: % of current holding to sell (e.g., 100 = sell entire position)
      // HOLD/SKIP: null
      reasoning: z.string(),
    })
  ),
  overallMarketRead: z.string(),
});

export type AIDecisionOutput = z.infer<typeof decisionSchema>;

export interface PortfolioStateForPrompt {
  deployableCash: number;
  totalValue: number;
  holdings: Array<{
    ticker: string;
    shares: number;
    avgCostBasis: number;
    currentPrice: number | null;
    marketValue: number | null;
  }>;
}

export interface PipelineConfigForPrompt {
  thesis: string;
  strategyType: string;
  maxPositionPct: string;
  minCashReservePct: string;
  earningsLookbackDays: number;
  earningsForwardDays: number;
  minConfidenceThreshold: string;
}

export function buildPrompt(
  pipeline: PipelineConfigForPrompt,
  tickers: string[],
  earningsMap: Map<string, EarningsSignal>,
  portfolioState: PortfolioStateForPrompt,
  today: string
): string {
  const signalLines = tickers.map((ticker) => {
    const signal = earningsMap.get(ticker);
    if (!signal) return `${ticker}: no earnings data in window`;
    return (
      `${ticker}: report=${signal.reportDate} ${signal.reportTime ?? ""} | ` +
      `EPS actual=${signal.epsActual ?? "?"} estimate=${signal.epsEstimate ?? "?"} ` +
      `beat=${signal.epsBeat ?? "?"} surprise=${signal.epsSurprisePct != null ? signal.epsSurprisePct.toFixed(1) + "%" : "?"} | ` +
      `Rev beat=${signal.revenueBeat ?? "?"}`
    );
  });

  const holdingLines =
    portfolioState.holdings.length > 0
      ? portfolioState.holdings.map(
          (h) =>
            `${h.ticker}: ${h.shares.toFixed(2)} shares @ $${h.avgCostBasis.toFixed(2)} avg cost, ` +
            `current=$${h.currentPrice?.toFixed(2) ?? "?"}, value=$${h.marketValue?.toFixed(2) ?? "?"}`
        )
      : ["None"];

  const cashFloor = portfolioState.totalValue * (parseFloat(pipeline.minCashReservePct) / 100);

  return `You are an autonomous AI investment strategy executor for a paper trading simulator. Today: ${today}.

## Investment Strategy
Type: ${pipeline.strategyType}

Thesis:
${pipeline.thesis}

## Portfolio State
Deployable cash: $${portfolioState.deployableCash.toFixed(2)}
Total portfolio value: $${portfolioState.totalValue.toFixed(2)}
Minimum cash reserve (do not breach): $${cashFloor.toFixed(2)} (${pipeline.minCashReservePct}%)
Maximum single position size: ${pipeline.maxPositionPct}% of portfolio ($${(portfolioState.totalValue * parseFloat(pipeline.maxPositionPct) / 100).toFixed(2)})

Current holdings:
${holdingLines.join("\n")}

## Earnings Signals (${pipeline.earningsLookbackDays}d lookback + ${pipeline.earningsForwardDays}d forward)
${signalLines.join("\n")}

## Instructions
Evaluate every ticker in the list above and return a decision for each.

Rules:
- Ground all decisions in the investment thesis
- Use earnings signals as the primary trigger for action
- BUY: sharesPct = % of deployable cash to allocate (e.g., 15 means spend 15% of deployable cash)
- SELL: sharesPct = % of current holding to sell (e.g., 50 means sell half the position)
- HOLD: you own this and want to keep it — sharesPct = null
- SKIP: no action warranted for this ticker — sharesPct = null
- Confidence must be 0.0–1.0. Anything below ${pipeline.minConfidenceThreshold} will be auto-skipped by the system — be honest.
- Do NOT suggest buying a ticker you have no thesis for just because cash is available.
- Return SKIP for tickers with no earnings signal AND no current holding unless the thesis warrants speculative positioning.`;
}
```

---

## 4. API Routes

### Auth note

All pipeline CRUD routes use the standard `auth()` session pattern from existing routes. The `PIPELINE_SECRET` bypass is only on `/api/trade`.

### 4.1 `/api/strategy-templates/route.ts` — GET, POST

**GET** — list all templates owned by authenticated user.

```typescript
// Response
{ templates: StrategyTemplate[] }
```

**POST** — create new template. All config fields optional (use defaults).

```typescript
// Body
{
  name: string;
  description?: string;
  strategyType?: "thesis_driven" | "signal_driven";
  thesis: string;
  tickerUniverse?: string[];
  maxPositions?: number;
  maxPositionPct?: number;
  minCashReservePct?: number;
  earningsLookbackDays?: number;
  earningsForwardDays?: number;
  minConfidenceThreshold?: number;
  autonomous?: boolean;
  rebalanceOnRun?: boolean;
  hypothesisConfig?: string;
}
// Response: { template: StrategyTemplate }
```

### 4.2 `/api/strategy-templates/[id]/route.ts` — GET, PATCH, DELETE

**GET** — fetch single template (must be owned by user).

**PATCH** — partial update. Same shape as POST, all fields optional. On update:
1. Find all pipelines with this `templateId`
2. For each pipeline, re-apply updated template values for fields NOT in that pipeline's `configOverrides`
3. Return `{ template, updatedPipelineIds: string[] }`

**DELETE** — check if any active pipelines reference this template. If yes: 409 + list of pipeline names. Otherwise delete.

### 4.3 `/api/pipelines/route.ts` — GET, POST

**GET** — list pipelines for user with aggregated fields:

```typescript
{
  pipelines: Array<{
    // all Pipeline fields
    portfolioCount: number;
    lastRunStatus: "completed" | "failed" | "skipped" | null;
    lastRunAt: string | null;
  }>
}
```

**POST** — create pipeline.

```typescript
// Body
{
  name: string;
  templateId?: string;
  thesis: string;
  strategyType?: string;
  // ... all config fields (override template or set standalone)
  portfolioAssignments?: Array<{ portfolioId: string; allocationPct?: number }>;
}
```

**Inheritance resolution on create:**
1. If `templateId` provided, load template
2. Start with template field values as base
3. Apply any user-provided field values on top
4. `configOverrides` = fields where user value differed from template default
5. Write resolved values to pipeline columns
6. Create `pipeline_portfolios` rows for any `portfolioAssignments`

### 4.4 `/api/pipelines/[id]/route.ts` — GET, PATCH, DELETE

**GET** — fetch with relations:

```typescript
{
  pipeline: Pipeline;
  template: StrategyTemplate | null;
  portfolios: Array<{ portfolio: Portfolio; allocationPct: number }>;
  recentRuns: PipelineRun[]; // last 10
}
```

**PATCH** — partial update. Re-runs inheritance resolution if `templateId` or config fields change. Returns `{ pipeline }`.

**DELETE** — archive vs hard delete:
```typescript
// Check for existing runs
const hasRuns = await db.select({ id: pipelineRuns.id })
  .from(pipelineRuns)
  .where(eq(pipelineRuns.pipelineId, id))
  .limit(1);

if (hasRuns[0]) {
  await db.update(pipelines).set({ status: "archived" }).where(eq(pipelines.id, id));
  return NextResponse.json({ archived: true });
}
await db.delete(pipelines).where(eq(pipelines.id, id));
return NextResponse.json({ deleted: true });
```

### 4.5 `/api/pipelines/[id]/portfolios/route.ts` — POST

Assign portfolio to pipeline.

```typescript
// Body: { portfolioId: string; allocationPct?: number }
// Validates portfolio belongs to same user
// Returns 409 if already assigned to this pipeline
// Returns 409 if portfolio is already assigned to a DIFFERENT active pipeline
//   → check: SELECT pp.pipeline_id FROM pipeline_portfolios pp
//              JOIN pipelines p ON p.id = pp.pipeline_id
//              WHERE pp.portfolio_id = :portfolioId AND p.status = 'active'
//     If a row exists and pipeline_id !== this pipeline id, return:
//       { error: "Portfolio is already assigned to an active pipeline", conflictingPipelineId }
//     with status 409
```

**Edge case:** A portfolio may only be managed by one active pipeline at a time. This prevents conflicting autonomous trade decisions on the same portfolio.

### 4.6 `/api/pipelines/[id]/portfolios/[portfolioId]/route.ts` — DELETE

Remove pipeline-portfolio assignment.

### 4.7 `/api/pipelines/[id]/runs/route.ts` — GET

```typescript
// Query: ?limit=20&offset=0
// Response: { runs: PipelineRun[], total: number }
```

### 4.8 `/api/pipelines/[id]/runs/[runId]/decisions/route.ts` — GET

```typescript
// Response: { decisions: DecisionLog[], run: PipelineRun }
```

### 4.9 Updated `/api/trade/route.ts`

Add `PIPELINE_SECRET` bypass at the top of the POST handler, before `auth()`:

```typescript
// Add at top of POST, before auth() call:
const pipelineSecret = req.headers.get("x-pipeline-secret");
let isPipelineRequest = false;

if (pipelineSecret !== null) {
  if (pipelineSecret !== process.env.PIPELINE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  isPipelineRequest = true;
}

// Conditionally require session auth
let authedUserId: string | null = null;
if (!isPipelineRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... existing user lookup to get authedUserId
} else {
  // Pipeline requests MUST include userId in the request body.
  // The ownership check runs for both session and pipeline requests.
  authedUserId = body.userId ?? null;
  if (!authedUserId) {
    return NextResponse.json({ error: "userId required for pipeline requests" }, { status: 400 });
  }
}

// Portfolio ownership check (runs for ALL requests, including pipeline):
// verify portfolios.userId === authedUserId
// This ensures the pipeline can only trade on portfolios owned by the specified user.
```

Pipeline requests pass the same body fields as regular requests **plus `userId`**. The `userId` must match the portfolio owner — the pipeline run executor already has this from the pipeline record.

### 4.9.1 `src/lib/trade-executor.ts` — Extracted Trade Logic

Extract the inner transaction block from `/api/trade` into a standalone callable function so the pipeline run executor can call it directly without a self-HTTP request:

```typescript
// src/lib/trade-executor.ts

import { db } from "@/db";
import { holdings, portfolios, transactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface ExecuteTradeParams {
  portfolioId: string;
  ticker: string;
  type: "BUY" | "SELL";
  shares: number;
  userId: string;
}

export interface ExecuteTradeResult {
  success: boolean;
  error?: string;
}

/**
 * Execute a single trade within a DB transaction.
 * Validates portfolio ownership, cash balance, and holding existence.
 * Both /api/trade and the pipeline run executor call this directly.
 */
export async function executeTrade(params: ExecuteTradeParams): Promise<ExecuteTradeResult> {
  const { portfolioId, ticker, type, shares, userId } = params;

  return db.transaction(async (tx) => {
    const portfolio = await tx.query.portfolios.findFirst({
      where: eq(portfolios.id, portfolioId),
    });

    if (!portfolio) return { success: false, error: "Portfolio not found" };
    if (portfolio.userId !== userId) return { success: false, error: "Unauthorized" };

    // ... remainder of existing trade transaction logic (price lookup, holding upsert, cash update, transaction insert)
    // Move existing db.transaction() body here verbatim.

    return { success: true };
  });
}
```

Both `/api/trade` and `/api/pipeline/run` import and call `executeTrade(...)` directly. The pipeline run executor **does not** use `fetch('/api/trade')`.

### 4.10 `/api/cron/pipeline-orchestrator/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Client as QStashClient } from "@upstash/qstash";
import { db } from "@/db";
import { pipelines } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activePipelines = await db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(eq(pipelines.status, "active"));

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXTAUTH_URL!;

  const dispatched: string[] = [];
  const failed: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const pipeline of activePipelines) {
    try {
      await qstash.publishJSON({
        url: `${baseUrl}/api/pipeline/run`,
        body: { pipelineId: pipeline.id, triggeredBy: "cron" },
        headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET! },
        retries: 2,
        // Deduplicate: one run per pipeline per day
        deduplicationId: `pipeline-run-${pipeline.id}-${today}`,
      });
      dispatched.push(pipeline.id);
    } catch (err) {
      console.error(`[orchestrator] Failed to dispatch ${pipeline.id}:`, err);
      failed.push(pipeline.id);
    }
  }

  return NextResponse.json({ dispatched: dispatched.length, failed: failed.length });
}
```

Add to `vercel.json` crons array:
```json
{ "path": "/api/cron/pipeline-orchestrator", "schedule": "0 23 * * *" }
```

### 4.11 `/api/pipeline/run/route.ts`

QStash receiver. Full execution logic.

```typescript
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { db } from "@/db";
import {
  pipelines, pipelineRuns, decisionLog, holdings,
  portfolios, cachedQuotes, stockUniverse
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { fetchEarningsSignals } from "@/lib/earnings";
import { buildPrompt, decisionSchema } from "@/lib/pipeline-prompt";
import { executeTrade } from "@/lib/trade-executor";

export const POST = verifySignatureAppRouter(async (req: NextRequest) => {
  const startTime = Date.now();
  const { pipelineId, triggeredBy = "qstash" } = await req.json();

  if (!pipelineId) {
    return NextResponse.json({ error: "pipelineId required" }, { status: 400 });
  }

  // Load pipeline with portfolio assignments
  const pipeline = await db.query.pipelines.findFirst({
    where: eq(pipelines.id, pipelineId),
    with: { portfolioLinks: { with: { portfolio: true } } },
  });

  if (!pipeline || pipeline.status !== "active") {
    return NextResponse.json({ skipped: true, reason: "pipeline not active" });
  }

  // Atomically guard against concurrent runs using a unique partial index:
  //   CREATE UNIQUE INDEX pipeline_run_active ON pipeline_runs (pipeline_id) WHERE status = 'running';
  // The INSERT itself is the lock — no prior SELECT needed.
  let run: typeof pipelineRuns.$inferSelect;
  try {
    [run] = await db
      .insert(pipelineRuns)
      .values({ pipelineId, status: "running", triggeredBy })
      .returning();
  } catch (err) {
    // Unique constraint violation means a run is already in progress
    if (err instanceof Error && err.message.includes("pipeline_run_active")) {
      return NextResponse.json({ skipped: true, reason: "run already in progress" });
    }
    throw err;
  }

  try {
    // Resolve ticker universe
    let tickers: string[];
    if (pipeline.tickerUniverse.length > 0) {
      tickers = pipeline.tickerUniverse;
    } else {
      const universe = await db
        .select({ ticker: stockUniverse.ticker })
        .from(stockUniverse)
        .limit(50); // Cap at DB level to avoid timeout
      tickers = universe.map((u) => u.ticker);
    }

    // Fetch earnings signals (cache-first, Finnhub fallback)
    const earningsMap = await fetchEarningsSignals(
      tickers,
      pipeline.earningsLookbackDays,
      pipeline.earningsForwardDays
    );

    // Build portfolio state for each assigned portfolio
    const today = new Date().toISOString().split("T")[0];
    let totalExecuted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const link of pipeline.portfolioLinks) {
      const portfolioId = link.portfolioId;

      // Fetch holdings
      const holdingRows = await db
        .select()
        .from(holdings)
        .where(eq(holdings.portfolioId, portfolioId));

      const quoteRows = holdingRows.length > 0
        ? await db.select().from(cachedQuotes).where(
            inArray(cachedQuotes.ticker, holdingRows.map((h) => h.ticker))
          )
        : [];
      const quoteMap = new Map(quoteRows.map((q) => [q.ticker, parseFloat(q.price)]));

      const holdingsWithValue = holdingRows.map((h) => ({
        ticker: h.ticker,
        shares: parseFloat(h.shares),
        avgCostBasis: parseFloat(h.avgCostBasis),
        currentPrice: quoteMap.get(h.ticker) ?? null,
        marketValue: quoteMap.get(h.ticker) ? parseFloat(h.shares) * quoteMap.get(h.ticker)! : null,
      }));

      const cashBalance = parseFloat(link.portfolio.cashBalance);
      const totalValue =
        cashBalance + holdingsWithValue.reduce((s, h) => s + (h.marketValue ?? 0), 0);
      const deployableCash = cashBalance * (parseFloat(link.allocationPct) / 100);

      const portfolioState = { deployableCash, totalValue, holdings: holdingsWithValue };

      // Call AI
      let aiOutput: typeof decisionSchema._type;
      try {
        const { object } = await generateObject({
          model: anthropic("claude-3-5-haiku-20241022"),
          schema: decisionSchema,
          prompt: buildPrompt(pipeline, tickers, earningsMap, portfolioState, today),
          maxTokens: 4096,
        });
        aiOutput = object;
      } catch (aiErr) {
        console.error("[pipeline/run] AI failed:", aiErr);
        throw aiErr;
      }

      // Filter to valid tickers only
      const validDecisions = aiOutput.decisions.filter((d) => tickers.includes(d.ticker));
      const cashFloor = totalValue * (parseFloat(pipeline.minCashReservePct) / 100);
      let remainingCash = deployableCash;

      for (const decision of validDecisions) {
        const signalSummary = earningsMap.get(decision.ticker)
          ? JSON.stringify(earningsMap.get(decision.ticker))
          : null;

        // Short-circuit non-actionable decisions
        if (decision.action === "HOLD" || decision.action === "SKIP") {
          await db.insert(decisionLog).values({
            runId: run.id,
            pipelineId,
            portfolioId,
            ticker: decision.ticker,
            action: decision.action,
            confidence: String(decision.confidence),
            reasoning: decision.reasoning,
            signalSummary,
            executed: false,
            executionError: null,
          });
          totalSkipped++;
          continue;
        }

        // Confidence gate
        if (decision.confidence < parseFloat(pipeline.minConfidenceThreshold)) {
          await db.insert(decisionLog).values({
            runId: run.id, pipelineId, portfolioId,
            ticker: decision.ticker, action: decision.action,
            confidence: String(decision.confidence),
            reasoning: decision.reasoning, signalSummary,
            executed: false, executionError: "confidence_below_threshold",
          });
          totalSkipped++;
          continue;
        }

        // Autonomous gate
        if (!pipeline.autonomous) {
          await db.insert(decisionLog).values({
            runId: run.id, pipelineId, portfolioId,
            ticker: decision.ticker, action: decision.action,
            confidence: String(decision.confidence),
            reasoning: decision.reasoning, signalSummary,
            executed: false, executionError: "pipeline_not_autonomous",
          });
          totalSkipped++;
          continue;
        }

        let executedShares: number | null = null;
        let priceAtDecision: number | null = null;
        let executionError: string | null = null;
        let executed = false;

        if (decision.action === "BUY") {
          // maxPositions enforcement: count current unique holdings before buying
          const currentPositionCount = holdingsWithValue.filter((h) => h.shares > 0).length;
          const isNewPosition = !holdingsWithValue.some((h) => h.ticker === decision.ticker && h.shares > 0);
          if (isNewPosition && currentPositionCount >= pipeline.maxPositions) {
            await db.insert(decisionLog).values({
              runId: run.id, pipelineId, portfolioId,
              ticker: decision.ticker, action: decision.action,
              confidence: String(decision.confidence),
              reasoning: decision.reasoning, signalSummary,
              executed: false, executionError: "max_positions_reached",
            });
            totalSkipped++;
            continue;
          }

          const availableCash = Math.max(0, Math.min(remainingCash, cashBalance - cashFloor));
          if (availableCash < 1) {
            executionError = "insufficient_cash";
          } else {
            const allocAmount = availableCash * ((decision.sharesPct ?? 10) / 100);
            const quote = await db.select().from(cachedQuotes)
              .where(eq(cachedQuotes.ticker, decision.ticker)).limit(1);

            if (!quote[0]) {
              executionError = "no_price_data";
            } else {
              priceAtDecision = parseFloat(quote[0].price);
              let sharesToBuy = allocAmount / priceAtDecision;
              const currentHolding = holdingsWithValue.find((h) => h.ticker === decision.ticker);
              const existingValue = currentHolding?.marketValue ?? 0;
              const maxPositionValue = totalValue * (parseFloat(pipeline.maxPositionPct) / 100);
              const allowedIncrease = Math.max(0, maxPositionValue - existingValue);

              if (allowedIncrease < 1) {
                executionError = "max_position_size_reached";
              } else {
                const cappedAmount = Math.min(allocAmount, allowedIncrease);
                sharesToBuy = cappedAmount / priceAtDecision;
                const tradeResult = await executeTrade({
                  portfolioId,
                  ticker: decision.ticker,
                  type: "BUY",
                  shares: sharesToBuy,
                  userId: pipeline.userId,
                });
                if (tradeResult.success) {
                  executed = true;
                  executedShares = sharesToBuy;
                  remainingCash -= cappedAmount;
                  totalExecuted++;
                } else {
                  executionError = tradeResult.error ?? "trade_api_error";
                  totalFailed++;
                }
              }
            }
          }
        } else if (decision.action === "SELL") {
          const holding = holdingsWithValue.find((h) => h.ticker === decision.ticker);
          if (!holding || holding.shares <= 0) {
            executionError = "no_holding";
          } else {
            priceAtDecision = holding.currentPrice;
            const sellShares = holding.shares * ((decision.sharesPct ?? 100) / 100);
            const tradeResult = await executeTrade({
              portfolioId,
              ticker: decision.ticker,
              type: "SELL",
              shares: sellShares,
              userId: pipeline.userId,
            });
            if (tradeResult.success) {
              executed = true;
              executedShares = sellShares;
              totalExecuted++;
            } else {
              executionError = tradeResult.error ?? "trade_api_error";
              totalFailed++;
            }
          }
        }

        if (!executed && !executionError) executionError = "unknown";
        if (!executed) totalSkipped++;

        await db.insert(decisionLog).values({
          runId: run.id, pipelineId, portfolioId,
          ticker: decision.ticker, action: decision.action,
          confidence: String(decision.confidence),
          shares: executedShares !== null ? String(executedShares) : null,
          priceAtDecision: priceAtDecision !== null ? String(priceAtDecision) : null,
          reasoning: decision.reasoning, signalSummary,
          executed, executionError,
        });
      }
    }

    // Finalize run
    await db.update(pipelineRuns).set({
      status: "completed",
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      tickersEvaluated: tickers.length,
      tradesExecuted: totalExecuted,
      tradesSkipped: totalSkipped,
      tradesFailed: totalFailed,
    }).where(eq(pipelineRuns.id, run.id));

    // Calculate nextRunAt: daily cron fires at 23:00 UTC, so next run is tomorrow at 23:00 UTC
    const nextRun = new Date();
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    nextRun.setUTCHours(23, 0, 0, 0);

    await db.update(pipelines)
      .set({ lastRunAt: new Date(), nextRunAt: nextRun })
      .where(eq(pipelines.id, pipelineId));

    return NextResponse.json({ success: true, executed: totalExecuted, skipped: totalSkipped });
  } catch (err) {
    await db.update(pipelineRuns).set({
      status: "failed",
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    }).where(eq(pipelineRuns.id, run.id));

    return NextResponse.json({ error: "Pipeline run failed" }, { status: 500 });
  }
});
```

### 4.12 `POST /api/pipelines/[id]/trigger`

Manual pipeline trigger. Auth-gated (user session), verifies ownership, then publishes to QStash with a unique dedup key that bypasses the daily cron dedup key so it runs immediately.

```typescript
// Auth: standard auth() session — user must own the pipeline
// Body: (none required)
// Response: 202 Accepted { queued: true, pipelineId }

// Implementation:
// 1. Verify session and ownership (pipeline.userId === session.user.id)
// 2. Publish to QStash:
await qstash.publishJSON({
  url: `${baseUrl}/api/pipeline/run`,
  body: { pipelineId: pipeline.id, triggeredBy: "manual" },
  headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET! },
  retries: 1,
  // Dedup key differs from the daily cron key so it bypasses same-day dedup.
  // Uses timestamp to allow multiple manual triggers per day.
  deduplicationId: `pipeline-manual-${pipeline.id}-${Date.now()}`,
});
// 3. Return 202
```

**Note:** The request still arrives at `/api/pipeline/run` via QStash, so `verifySignatureAppRouter` is satisfied at the receiver. The manual trigger never calls the run route directly.

---

## 5. Inheritance Resolution

### Config defaults

```typescript
// src/lib/pipeline-defaults.ts

export const DEFAULT_PIPELINE_CONFIG = {
  strategyType: "thesis_driven" as const,
  tickerUniverse: [] as string[],
  maxPositions: 10,
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.65",
  autonomous: true,
  allowShortSell: false,
  rebalanceOnRun: false,
  hypothesisConfig: null as string | null,
};

export const INHERITABLE_FIELDS = [
  "thesis", "strategyType", "tickerUniverse",
  "maxPositions", "maxPositionPct", "minCashReservePct",
  "earningsLookbackDays", "earningsForwardDays",
  "minConfidenceThreshold", "autonomous", "allowShortSell",
  "rebalanceOnRun", "hypothesisConfig",
] as const;
```

### Resolution function

```typescript
// src/lib/pipeline-config.ts

import { DEFAULT_PIPELINE_CONFIG, INHERITABLE_FIELDS } from "./pipeline-defaults";
import type { StrategyTemplate } from "@/db/schema";

type PipelineInput = Partial<Record<typeof INHERITABLE_FIELDS[number], unknown>>;

export function resolveConfig(
  template: StrategyTemplate | null,
  userInput: PipelineInput
): { resolved: typeof DEFAULT_PIPELINE_CONFIG; overrides: string[] } {
  const base = template ?? DEFAULT_PIPELINE_CONFIG;
  const overrides: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolved: any = { ...base };

  for (const field of INHERITABLE_FIELDS) {
    if (field in userInput && userInput[field] !== undefined) {
      const templateValue = (base as Record<string, unknown>)[field];
      const userValue = userInput[field];
      // Track as override if it differs from template/default
      if (JSON.stringify(userValue) !== JSON.stringify(templateValue)) {
        overrides.push(field);
      }
      resolved[field] = userValue;
    }
  }

  return { resolved, overrides };
}
```

### Template sync (on PATCH strategy-templates/[id])

After updating a template, find all pipelines using it and re-apply non-overridden fields:

```typescript
const affectedPipelines = await db
  .select()
  .from(pipelines)
  .where(eq(pipelines.templateId, templateId));

const updatedIds: string[] = [];
for (const pipeline of affectedPipelines) {
  const nonOverriddenUpdates: Partial<typeof pipelines.$inferInsert> = {};
  for (const field of INHERITABLE_FIELDS) {
    if (!pipeline.configOverrides.includes(field)) {
      // Re-apply from updated template
      (nonOverriddenUpdates as Record<string, unknown>)[field] =
        (updatedTemplate as Record<string, unknown>)[field];
    }
  }
  if (Object.keys(nonOverriddenUpdates).length > 0) {
    await db.update(pipelines).set({ ...nonOverriddenUpdates, updatedAt: new Date() })
      .where(eq(pipelines.id, pipeline.id));
    updatedIds.push(pipeline.id);
  }
}
```

---

## 6. Control Panel UI

### File structure

```
src/app/
  pipelines/
    page.tsx                     # Pipeline list
    new/
      page.tsx                   # Create pipeline
    [id]/
      page.tsx                   # Pipeline detail (tabs)
  strategy-templates/
    page.tsx                     # Template list + management
```

### `/pipelines` — Pipeline List Page

- Header: "AI Pipelines" + "New Pipeline" button (links to `/pipelines/new`)
- Status filter tabs: All / Active / Paused / Archived (client-side filter)
- Pipeline cards grid:
  - Name + status badge (active=`text-green-400 bg-green-400/10`, paused=`text-yellow-400 bg-yellow-400/10`, archived=`text-slate-400 bg-slate-400/10`)
  - Strategy type chip
  - Template name (if linked), with "inherits" label
  - Last run: relative time + status icon (✓ completed, ✗ failed, — skipped)
  - Portfolio count badge
  - "Run now" button → POST to `/api/pipeline/run` directly from client (for manual triggers, wire through a simple `/api/pipelines/[id]/trigger` route that queues via QStash or runs inline)
  - Kebab menu: Edit / Pause-Resume / Archive
- Bulk selection mode:
  - Checkbox per card; when any selected, show sticky bottom bar
  - Actions: Pause, Activate, Run Now, Archive, Sync to Template

### `/pipelines/new` — Create Pipeline

Two-column layout (form left, live preview right showing resolved config):

**Left form sections:**
1. **Strategy Template** (optional): searchable dropdown of user's templates. On select, auto-fills all fields and marks them as "inherited"
2. **Basic**: Name (required), Strategy Type (select: thesis_driven / signal_driven)
3. **Thesis**: full-width textarea with placeholder examples per strategy type
4. **Ticker Universe**: tag input — type ticker + Enter to add. Empty = AI selects from all stocks. Show note: "Leave empty to let the AI choose from the full stock universe."
5. **Execution Levers** (collapsible section): numeric inputs for all config fields. Fields inherited from template show a "From template" badge; overriding removes the badge and adds "Override"
6. **Autonomy**: toggle for `autonomous` + `rebalanceOnRun`
7. **Portfolios**: checklist of user's portfolios, each with an allocation % input (default 100%)

**Right live preview**: Shows the resolved config in a clean card. Updates as user types.

### `/pipelines/[id]` — Pipeline Detail

Four tabs:

**Overview tab:**
- Config summary card (all resolved fields)
- Template source (if any) with link
- Overridden fields list
- Portfolio assignments table: portfolio name, allocation %, total value, current cash

**Run History tab:**
- Table: Date, Triggered By, Status, Tickers Evaluated, Executed, Skipped, Failed, Duration
- Click row → expands inline or navigates to decisions view
- Pagination: load more

**Decision Log tab:**
- Run selector dropdown at top (defaults to most recent completed run)
- Table per portfolio: Ticker, Action, Confidence bar, Shares, Price, Executed? (✓/✗), Reason if skipped, Reasoning (expandable)
- Color coding: BUY=green, SELL=red, HOLD=blue, SKIP=slate

**Settings tab:**
- Full config edit form (same as create, pre-filled)
- Danger zone: Archive / Delete

### `/strategy-templates` — Template Management

- List: Name, Type, # Pipelines using it, Last Updated, Actions (Edit/Delete)
- Create/Edit: same form shape as pipeline create but without portfolio assignments
- Delete guard: modal showing pipeline names that would be affected

### UI Standards

All pages follow existing PaperTrader patterns:
- `bg-slate-950` page background, `bg-slate-900` cards, `bg-slate-800` secondary areas
- `border-slate-700/50` borders
- `text-slate-100` primary text, `text-slate-400` secondary text
- Buttons: `bg-indigo-600 hover:bg-indigo-700` primary; `bg-slate-700 hover:bg-slate-600` secondary
- Use `@base-ui/react` components for Dialog, Select, Tabs, Checkbox
- Skeleton loaders for all async data
- Toast notifications for mutations (success/error)
- No markdown tables in the UI — use HTML tables with existing table styles

---

## 7. Edge Cases

| Scenario | Handling |
|---|---|
| Run already in progress | Guard query on `status = 'running'`; return `{skipped: true}` with 200 so QStash doesn't retry |
| Portfolio has insufficient cash | Per-trade guard; log `executionError: 'insufficient_cash'`; run continues for other tickers |
| Cash drops below reserve floor | `availableCash = max(0, cashBalance - cashFloor)`; skips BUY if ≤ $1 |
| AI returns invalid ticker | Filter `validDecisions` to tickers in the original universe list; unknown tickers silently dropped |
| AI returns malformed JSON | `generateObject` with Zod schema throws on parse failure; caught in outer try/catch; run marked `failed` |
| QStash retry after success | `deduplicationId: pipeline-run-{id}-{date}` prevents duplicate same-day runs |
| QStash retry while run is in progress | In-progress guard catches it; returns 200 `{skipped: true}` |
| Deleting pipeline with run history | Archive instead of hard delete; archived pipelines excluded from cron dispatch |
| Earnings data unavailable | Prompt notes "no earnings data in window"; AI expected to SKIP; no error thrown |
| Finnhub rate limit (60/min) | 200ms delay per call in `fetchEarningsSignals`; natural jitter from QStash delivery offsets concurrent pipeline runs |
| Vercel 60s timeout | Orchestrator only dispatches (fast); each `/api/pipeline/run` handles one pipeline; 50 tickers × 200ms + AI call ≈ 25–35s, well under limit |
| Template deleted with active pipelines | 409 response listing pipeline names; user must reassign or delete pipelines first |
| Portfolio removed while assigned to pipeline | `onDelete: cascade` removes `pipeline_portfolios` row; next run skips that portfolio |
| Portfolio assigned to multiple active pipelines | 409 on POST `/api/pipelines/[id]/portfolios`; a portfolio may only be managed by one active pipeline at a time |
| maxPositions limit reached on BUY | Skip decision, log `executionError: 'max_positions_reached'`; run continues for remaining tickers |
| Concurrent run inserts race | Unique partial index `pipeline_run_active` rejects the second INSERT; handler catches constraint error and returns `{skipped: true}` |
| Manual trigger same day as cron | Manual uses timestamp-based dedup key, not date-based, so both can execute independently |

---

## 8. Migration

### Steps

```bash
# After updating src/db/schema.ts:
pnpm drizzle-kit generate    # Creates migration file in drizzle/
pnpm drizzle-kit migrate     # Applies to DB (or use push for dev)
```

**Schema changes needed:**
- Add `unique` import from `drizzle-orm/pg-core`
- Add unique partial index for concurrency guard (run after migration):
  ```sql
  CREATE UNIQUE INDEX pipeline_run_active ON pipeline_runs (pipeline_id) WHERE status = 'running';
  ```
  > Or add as a Drizzle `index()` in the `pipelineRuns` table definition with a `.where(sql\`status = 'running'\`)` clause.
- Add 4 new enums (before tables that reference them)
- Add 6 new tables
- Add relations entries for new tables
- Extend existing relations (portfolios, users)

### New environment variables

| Variable | Where | Notes |
|---|---|---|
| `QSTASH_TOKEN` | Vercel + `.env.local` | From Upstash QStash console |
| `QSTASH_CURRENT_SIGNING_KEY` | Vercel + `.env.local` | From Upstash QStash console |
| `QSTASH_NEXT_SIGNING_KEY` | Vercel + `.env.local` | From Upstash QStash console |
| `ANTHROPIC_API_KEY` | Vercel + `.env.local` | From Anthropic console |
| `PIPELINE_SECRET` | Vercel + `.env.local` | Generate: `openssl rand -hex 32` |

### New packages

```bash
pnpm add @upstash/qstash ai @ai-sdk/anthropic zod yahoo-finance2
# zod must be a direct dependency (used in pipeline-prompt.ts schema)
# yahoo-finance2 is used for analyst revision direction in earnings.ts
```

---

## 9. Implementer Checklist

Implementation order (each step is unblocked by the prior):

1. **Install packages**: `pnpm add @upstash/qstash ai @ai-sdk/anthropic zod yahoo-finance2`
2. **Add all env vars** to `.env.local` and Vercel dashboard (use placeholder values locally)
3. **Update `src/db/schema.ts`**: add enums → tables → relations; extend `portfoliosRelations` and `usersRelations`
4. **Run migration**: `pnpm drizzle-kit generate && pnpm drizzle-kit migrate`
5. **Create `src/lib/earnings.ts`**: earnings fetch + cache logic with batch DB lookup and yahoo-finance2 analyst revision direction (unit-testable independently)
6. **Create `src/lib/pipeline-defaults.ts`**: `DEFAULT_PIPELINE_CONFIG`, `INHERITABLE_FIELDS`
7. **Create `src/lib/pipeline-config.ts`**: `resolveConfig` function
8. **Create `src/lib/pipeline-prompt.ts`**: `buildPrompt` + `decisionSchema` (Zod)
8a. **Create `src/lib/trade-executor.ts`**: extract `executeTrade()` from `/api/trade` transaction block
9. **Update `/api/trade/route.ts`**: add `PIPELINE_SECRET` bypass (keep ownership check; require `userId` in body)
10. **Create `/api/strategy-templates/route.ts`**: GET + POST
11. **Create `/api/strategy-templates/[id]/route.ts`**: GET + PATCH (with template sync) + DELETE
12. **Create `/api/pipelines/route.ts`**: GET + POST (with inheritance resolution)
13. **Create `/api/pipelines/[id]/route.ts`**: GET + PATCH + DELETE (archive logic)
14. **Create `/api/pipelines/[id]/portfolios/route.ts`**: POST
15. **Create `/api/pipelines/[id]/portfolios/[portfolioId]/route.ts`**: DELETE
16. **Create `/api/pipelines/[id]/runs/route.ts`**: GET
17. **Create `/api/pipelines/[id]/runs/[runId]/decisions/route.ts`**: GET
17a. **Create `/api/pipelines/[id]/trigger/route.ts`**: POST manual trigger (QStash dispatch, timestamp dedup key)
18. **Create `/api/cron/pipeline-orchestrator/route.ts`**: fan-out dispatcher
19. **Update `vercel.json`**: add orchestrator cron entry
20. **Create `/api/pipeline/run/route.ts`**: full QStash receiver + execution loop (uses `executeTrade()`, atomic run guard via unique partial index, `nextRunAt` calculation)
21. **Write tests**:
    - Unit: `earnings.ts` (mock Finnhub client), `pipeline-config.ts` (resolveConfig), `pipeline-prompt.ts` (buildPrompt output)
    - Integration: all API routes (mock DB + QStash), `/api/trade` PIPELINE_SECRET bypass
    - E2E smoke: create template → create pipeline → assign portfolio → POST `/api/pipeline/run` (mock AI) → verify decision_log rows + trade execution
22. **Build `src/app/strategy-templates/page.tsx`**: list + CRUD
23. **Build `src/app/pipelines/page.tsx`**: list with filters + bulk actions
24. **Build `src/app/pipelines/new/page.tsx`**: create form with template inheritance + live preview
25. **Build `src/app/pipelines/[id]/page.tsx`**: tabbed detail view (Overview, Run History, Decision Log, Settings)
26. **Add nav link** to `/pipelines` in sidebar (follow existing nav pattern)
27. **Manual integration test**: full flow end-to-end on local dev
28. **Deploy to Vercel preview**: verify cron registration + QStash webhook delivery
29. **Prod deploy**: confirm `PIPELINE_SECRET` and all Upstash keys are set

---

## Appendix: Type Exports

Add to end of `src/db/schema.ts`:

```typescript
export type StrategyTemplate = typeof strategyTemplates.$inferSelect;
export type NewStrategyTemplate = typeof strategyTemplates.$inferInsert;
export type Pipeline = typeof pipelines.$inferSelect;
export type NewPipeline = typeof pipelines.$inferInsert;
export type PipelinePortfolio = typeof pipelinePortfolios.$inferSelect;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type NewPipelineRun = typeof pipelineRuns.$inferInsert;
export type DecisionLog = typeof decisionLog.$inferSelect;
export type NewDecisionLog = typeof decisionLog.$inferInsert;
export type EarningsSignalRow = typeof earningsSignals.$inferSelect;
```

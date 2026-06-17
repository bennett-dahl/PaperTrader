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
  json,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Enums
export const transactionTypeEnum = pgEnum("transaction_type", ["BUY", "SELL"]);
export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high"]);

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
  "thesis_driven",
  "signal_driven",
  "kronos_rotation",
]);

// Users table
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Portfolios table
export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  startingBalance: decimal("starting_balance", { precision: 15, scale: 2 })
    .default("5000.00")
    .notNull(),
  cashBalance: decimal("cash_balance", { precision: 15, scale: 2 })
    .default("5000.00")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
});

// Holdings table
export const holdings = pgTable("holdings", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id")
    .references(() => portfolios.id, { onDelete: "cascade" })
    .notNull(),
  ticker: text("ticker").notNull(),
  shares: decimal("shares", { precision: 15, scale: 6 }).notNull(),
  avgCostBasis: decimal("avg_cost_basis", { precision: 15, scale: 4 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Transactions table
export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id")
    .references(() => portfolios.id, { onDelete: "cascade" })
    .notNull(),
  ticker: text("ticker").notNull(),
  type: transactionTypeEnum("type").notNull(),
  shares: decimal("shares", { precision: 15, scale: 6 }).notNull(),
  pricePerShare: decimal("price_per_share", { precision: 15, scale: 4 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 15, scale: 2 }).notNull(),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
  pipelineId: uuid("pipeline_id")
    .references(() => pipelines.id, { onDelete: "set null" }),
  costBasisAtSale: decimal("cost_basis_at_sale", { precision: 15, scale: 4 }),
});

// Portfolio snapshots table (for charting performance over time)
export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id")
    .references(() => portfolios.id, { onDelete: "cascade" })
    .notNull(),
  totalValue: decimal("total_value", { precision: 15, scale: 2 }).notNull(),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
});

// Watchlist table
export const watchlist = pgTable("watchlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id")
    .references(() => portfolios.id, { onDelete: "cascade" })
    .notNull(),
  ticker: text("ticker").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

// Cached quotes table (refreshed every 5 minutes via cron)
export const cachedQuotes = pgTable("cached_quotes", {
  ticker: text("ticker").primaryKey(),
  name: text("name"),
  price: decimal("price", { precision: 15, scale: 4 }).notNull(),
  change: decimal("change", { precision: 15, scale: 4 }).notNull(),
  changePercent: decimal("change_percent", { precision: 10, scale: 4 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Stock universe — pre-seeded list used by portfolio builder
export const stockUniverse = pgTable("stock_universe", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticker: text("ticker").unique().notNull(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  category: text("category").notNull(),
  riskLevel: riskLevelEnum("risk_level").notNull(),
  marketCap: text("market_cap").notNull(), // 'large', 'mid', 'small'
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Portfolio builder presets
export const portfolioBuilderPresets = pgTable("portfolio_builder_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  riskLevel: riskLevelEnum("risk_level").notNull(),
  investAmount: decimal("invest_amount", { precision: 15, scale: 2 }).notNull(),
  categories: text("categories").array().notNull().default([]),
  stockCount: integer("stock_count").notNull().default(5),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Strategy Templates
export const strategyTemplates = pgTable("strategy_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  strategyType: strategyTypeEnum("strategy_type").notNull().default("thesis_driven"),
  thesis: text("thesis").notNull(),
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
  hypothesisConfig: text("hypothesis_config"),
  // Kronos-specific configuration
  kronosTickerUniverse: json("kronos_ticker_universe").$type<string[]>().default([]),
  kronosRebalancePct: decimal("kronos_rebalance_pct", { precision: 5, scale: 2 }).default("50.00"),
  kronosMinSignalPct: decimal("kronos_min_signal_pct", { precision: 5, scale: 2 }).default("1.00"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Pipelines
export const pipelines = pgTable("pipelines", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  templateId: uuid("template_id")
    .references(() => strategyTemplates.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: pipelineStatusEnum("status").notNull().default("active"),
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
  hypothesisConfig: text("hypothesis_config"),
  configOverrides: text("config_overrides").array().notNull().default([]),
  // Kronos-specific configuration
  kronosTickerUniverse: json("kronos_ticker_universe").$type<string[]>().default([]),
  kronosRebalancePct: decimal("kronos_rebalance_pct", { precision: 5, scale: 2 }).default("50.00"),
  kronosMinSignalPct: decimal("kronos_min_signal_pct", { precision: 5, scale: 2 }).default("1.00"),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Kronos Forecasts
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
    forecastDate: text("forecast_date").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pipelineDateIdx: index("kronos_forecasts_pipeline_date_idx").on(
      t.pipelineId,
      t.forecastDate
    ),
    uniq: unique("kronos_forecasts_pipeline_ticker_date_uniq").on(
      t.pipelineId,
      t.ticker,
      t.forecastDate
    ),
  })
);

// Pipeline Portfolios (many-to-many)
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
    assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: unique().on(t.pipelineId, t.portfolioId),
  })
);

// Pipeline Runs
export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineId: uuid("pipeline_id")
    .references(() => pipelines.id, { onDelete: "cascade" })
    .notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  triggeredBy: text("triggered_by").notNull().default("cron"),
  tickersEvaluated: integer("tickers_evaluated").default(0).notNull(),
  tradesExecuted: integer("trades_executed").default(0).notNull(),
  tradesSkipped: integer("trades_skipped").default(0).notNull(),
  tradesFailed: integer("trades_failed").default(0).notNull(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  durationMs: integer("duration_ms"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: decimal("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  forecastsLoadedAt: timestamp("forecasts_loaded_at"),
  forecastToRunGapMs: integer("forecast_to_run_gap_ms"),
});

// Decision Log
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
  shares: decimal("shares", { precision: 15, scale: 6 }),
  priceAtDecision: decimal("price_at_decision", { precision: 15, scale: 4 }),
  reasoning: text("reasoning").notNull(),
  signalSummary: text("signal_summary"),
  executed: boolean("executed").default(false).notNull(),
  executionError: text("execution_error"),
  decidedAt: timestamp("decided_at").defaultNow().notNull(),
});

// Earnings Signals (cache)
export const earningsSignals = pgTable(
  "earnings_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    reportDate: text("report_date").notNull(),
    reportTime: text("report_time"),
    epsActual: decimal("eps_actual", { precision: 10, scale: 4 }),
    epsEstimate: decimal("eps_estimate", { precision: 10, scale: 4 }),
    epsBeat: boolean("eps_beat"),
    epsSurprisePct: decimal("eps_surprise_pct", { precision: 8, scale: 4 }),
    analystRevisionDirection: text("analyst_revision_direction"),
    revenueActual: decimal("revenue_actual", { precision: 20, scale: 2 }),
    revenueEstimate: decimal("revenue_estimate", { precision: 20, scale: 2 }),
    revenueBeat: boolean("revenue_beat"),
    rawData: text("raw_data"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => ({
    tickerDateUniq: unique().on(t.ticker, t.reportDate),
  })
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  portfolios: many(portfolios),
  presets: many(portfolioBuilderPresets),
  strategyTemplates: many(strategyTemplates),
  pipelines: many(pipelines),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, { fields: [portfolios.userId], references: [users.id] }),
  holdings: many(holdings),
  transactions: many(transactions),
  snapshots: many(portfolioSnapshots),
  watchlist: many(watchlist),
  pipelineLinks: many(pipelinePortfolios),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [holdings.portfolioId],
    references: [portfolios.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [transactions.portfolioId],
    references: [portfolios.id],
  }),
  pipeline: one(pipelines, {
    fields: [transactions.pipelineId],
    references: [pipelines.id],
  }),
}));

export const portfolioSnapshotsRelations = relations(
  portfolioSnapshots,
  ({ one }) => ({
    portfolio: one(portfolios, {
      fields: [portfolioSnapshots.portfolioId],
      references: [portfolios.id],
    }),
  })
);

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [watchlist.portfolioId],
    references: [portfolios.id],
  }),
}));

export const portfolioBuilderPresetsRelations = relations(
  portfolioBuilderPresets,
  ({ one }) => ({
    user: one(users, {
      fields: [portfolioBuilderPresets.userId],
      references: [users.id],
    }),
  })
);

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
  kronosForecasts: many(kronosForecasts),
  transactions: many(transactions),
}));

export const kronosForecastsRelations = relations(kronosForecasts, ({ one }) => ({
  pipeline: one(pipelines, {
    fields: [kronosForecasts.pipelineId],
    references: [pipelines.id],
  }),
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

// TypeScript types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolio = typeof portfolios.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type NewPortfolioSnapshot = typeof portfolioSnapshots.$inferInsert;
export type WatchlistItem = typeof watchlist.$inferSelect;
export type NewWatchlistItem = typeof watchlist.$inferInsert;
export type CachedQuote = typeof cachedQuotes.$inferSelect;
export type StockUniverse = typeof stockUniverse.$inferSelect;
export type NewStockUniverse = typeof stockUniverse.$inferInsert;
export type PortfolioBuilderPreset = typeof portfolioBuilderPresets.$inferSelect;
export type NewPortfolioBuilderPreset = typeof portfolioBuilderPresets.$inferInsert;
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
export type KronosForecast = typeof kronosForecasts.$inferSelect;
export type NewKronosForecast = typeof kronosForecasts.$inferInsert;

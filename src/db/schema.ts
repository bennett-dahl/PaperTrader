import {
  pgTable,
  uuid,
  text,
  timestamp,
  decimal,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const transactionTypeEnum = pgEnum("transaction_type", ["BUY", "SELL"]);

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
  price: decimal("price", { precision: 15, scale: 4 }).notNull(),
  change: decimal("change", { precision: 15, scale: 4 }).notNull(),
  changePercent: decimal("change_percent", { precision: 10, scale: 4 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  portfolios: many(portfolios),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, { fields: [portfolios.userId], references: [users.id] }),
  holdings: many(holdings),
  transactions: many(transactions),
  snapshots: many(portfolioSnapshots),
  watchlist: many(watchlist),
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

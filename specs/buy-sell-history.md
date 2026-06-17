# Buy/Sell History Feature — Developer Spec

**Status:** Ready for implementation  
**Target:** Claude Code — implement end-to-end with no clarifying questions  
**Last updated:** 2026-06-16

---

## Overview

This feature adds a full transaction history view to PaperTrader, surfaced through a new `/portfolios/[id]` page with Holdings | History tabs. It also attributes trades to pipelines, snapshots cost-basis at sell time for P&L calculation, and exposes a "Your trades" mini-list inside the stock detail sheet.

---

## 1. Schema Migration

### 1.1 New Drizzle migration file

Create `drizzle/0005_buy_sell_history.sql`. Do not use `drizzle-kit generate` — write the SQL file manually following the existing migration format (each statement terminated with `;--> statement-breakpoint`).

```sql
ALTER TABLE "transactions" ADD COLUMN "pipeline_id" uuid REFERENCES "pipelines"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "cost_basis_at_sale" numeric(15, 4);
```

**Also update `drizzle/meta/_journal.json`** — without a journal entry the migration is silently ignored by Drizzle. Append a new entry to the `"entries"` array:

```json
{
  "idx": 5,
  "version": "7",
  "when": <current Unix timestamp in milliseconds, e.g. Date.now()>,
  "tag": "0005_buy_sell_history",
  "breakpoints": true
}
```

**Also create `drizzle/meta/0005_snapshot.json`** — copy the structure from `drizzle/meta/0004_snapshot.json` and update:
- Generate a new `"id"` UUID (any unique UUID)
- Set `"prevId"` to the `"id"` value from `0004_snapshot.json`
- Add the two new columns (`pipeline_id`, `cost_basis_at_sale`) to the `"public.transactions"` table entry in `"tables"`
- Add the FK from `pipeline_id` to `pipelines.id ON DELETE SET NULL` to the `"public.transactions"` table's `"foreignKeys"` object in `"tables"`, matching the format of existing FK entries in `0004_snapshot.json`. Without this, future `drizzle-kit generate` will detect schema drift.
- Keep all other tables and metadata identical to `0004_snapshot.json`

### 1.2 Schema.ts changes

**In the `transactions` table definition**, add two new columns after `executedAt`:

```ts
pipelineId: uuid("pipeline_id")
  .references(() => pipelines.id, { onDelete: "set null" }),
costBasisAtSale: decimal("cost_basis_at_sale", { precision: 15, scale: 4 }),
```

Both columns are nullable (no `.notNull()`).

**Update `transactionsRelations`** to add the pipeline relation:

```ts
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
```

**Update `pipelinesRelations`** to add the reverse (add `transactions: many(transactions)` inside the existing relations body):

```ts
// Add inside pipelinesRelations:
transactions: many(transactions),
```

### 1.3 TypeScript types

The `Transaction` and `NewTransaction` types are inferred from the table definition — they will automatically include `pipelineId: string | null` and `costBasisAtSale: string | null` after the schema change. No additional type changes needed beyond the table column additions above.

---

## 2. `src/lib/trade-executor.ts` changes

### 2.1 Interface update

Add `pipelineId?: string` to `ExecuteTradeParams`:

```ts
export interface ExecuteTradeParams {
  portfolioId: string;
  ticker: string;
  type: "BUY" | "SELL";
  shares: number;
  userId: string;
  /** Optional pre-fetched price. If omitted, executeTrade fetches from cache/Finnhub. */
  price?: number;
  /** Optional pipeline UUID. Written to the transaction row; null for manual trades. */
  pipelineId?: string;
}
```

### 2.2 SELL path — capture costBasisAtSale before deletion/reduction

In the SELL branch inside `db.transaction`, after the existing `SELECT` from `holdings` that fetches `existing[0]` (and before the holding is deleted or updated), capture `avgCostBasis`.

**Full scoping pattern inside `db.transaction(async (tx) => {`:**

```ts
let costBasisAtSale: string | null = null;

// BUY logic is unchanged ...

// In the SELL branch, the capture order is:
//   1. SELECT existing holding (already done)
//   2. null-guard: if (!existing[0]) throw new Error("You don't hold this stock")
//   3. THEN capture costBasisAtSale — must be AFTER the null-guard, never before:
costBasisAtSale = existing[0].avgCostBasis; // capture AFTER null-guard, BEFORE any delete/update
const existingShares = parseFloat(existing[0].shares);

// ... rest of SELL logic (delete or reduce holding, update cash balance) ...

// At the bottom (shared for BUY and SELL):
await tx.insert(transactions).values({
  portfolioId,
  ticker: ticker.toUpperCase(),
  type,
  shares: String(shares),
  pricePerShare: String(price),
  totalAmount: String(totalCost),
  pipelineId: params.pipelineId ?? null,
  costBasisAtSale,
});
```

- `costBasisAtSale` is `null` for BUY (never reassigned in the BUY branch).
- `costBasisAtSale` is the string value of `existing[0].avgCostBasis` for SELL, captured before the holding row is mutated or deleted.

---

## 3. `src/app/api/pipeline/run/route.ts` changes

Two `executeTrade(...)` calls exist in this file (one for BUY decisions, one for SELL decisions). Both need `pipelineId` added.

For the BUY call (around line 284):

```ts
const tradeResult = await executeTrade({
  portfolioId,
  ticker: decision.ticker,
  type: "BUY",
  shares: sharesToBuy,
  userId: pipeline.userId,
  pipelineId: pipeline.id,  // ADD THIS
});
```

For the SELL call (around line 310):

```ts
const tradeResult = await executeTrade({
  portfolioId,
  ticker: decision.ticker,
  type: "SELL",
  shares: sellShares,
  userId: pipeline.userId,
  pipelineId: pipeline.id,  // ADD THIS
});
```

No other changes to this file.

---

## 4. New API route: `GET /api/portfolios/[id]/transactions`

**File:** `src/app/api/portfolios/[id]/transactions/route.ts`

### 4.1 Full implementation

```ts
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, portfolios, transactions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: portfolioId } = await params;

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify portfolio ownership
  const portfolio = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, dbUser[0].id)))
    .limit(1);

  if (!portfolio[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  // Optional ticker filter — normalize to uppercase
  const { searchParams } = new URL(req.url);
  const tickerParam = searchParams.get("ticker");
  const tickerFilter = tickerParam ? tickerParam.toUpperCase() : null;

  // Query with pipeline relation
  const rows = await db.query.transactions.findMany({
    where: tickerFilter
      ? and(
          eq(transactions.portfolioId, portfolioId),
          eq(transactions.ticker, tickerFilter)
        )
      : eq(transactions.portfolioId, portfolioId),
    orderBy: [desc(transactions.executedAt)],
    limit: 100,
    with: {
      pipeline: {
        columns: { id: true, name: true },
      },
    },
  });

  const result = rows.map((row) => ({
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    shares: row.shares,
    pricePerShare: row.pricePerShare,
    totalAmount: row.totalAmount,
    costBasisAtSale: row.costBasisAtSale ?? null,
    executedAt: row.executedAt,
    pipelineId: row.pipelineId ?? null,
    pipelineName: row.pipeline?.name ?? null,
  }));

  return NextResponse.json(result);
}
```

### 4.2 Shared TypeScript type

Create `src/types/transactions.ts`:

```ts
export interface TransactionRow {
  id: string;
  ticker: string;
  type: "BUY" | "SELL";
  shares: string;
  pricePerShare: string;
  totalAmount: string;
  costBasisAtSale: string | null;
  executedAt: Date;
  pipelineId: string | null;
  pipelineName: string | null;
}
```

Export this from `src/types/index.ts` as well if that barrel file exists, or import directly from `@/types/transactions`.

---

## 5. New page: `/portfolios/[id]`

**File:** `src/app/(dashboard)/portfolios/[id]/page.tsx`

> Note: `src/app/(dashboard)/portfolios/page.tsx` already exists (the portfolios list page). This is a new dynamic route — create the `[id]` subdirectory.

### 5.1 Full page implementation

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users, holdings, cachedQuotes } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { HoldingWithPrice } from "@/types";
import PortfolioDetailTabs from "@/components/PortfolioDetailTabs";
import { refreshStaleQuotes } from "@/lib/refresh-quotes";

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  const { id: portfolioId } = await params;

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) redirect("/");

  // Verify ownership by fetching all user portfolios
  const allPortfolios = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id));

  const portfolio = allPortfolios.find((p) => p.id === portfolioId);
  if (!portfolio) redirect("/dashboard");

  // Fetch holdings
  const holdingsList = await db
    .select()
    .from(holdings)
    .where(eq(holdings.portfolioId, portfolioId));

  // Gather tickers, then refresh stale quotes before reading cache.
  // This matches the pattern used in the portfolio list page and snapshot cron.
  const tickers = holdingsList.map((h) => h.ticker);
  if (tickers.length > 0) {
    await refreshStaleQuotes(tickers);
  }

  // Fetch cached quotes for enrichment
  const quotes =
    tickers.length > 0
      ? await db
          .select()
          .from(cachedQuotes)
          .where(inArray(cachedQuotes.ticker, tickers))
      : [];

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  // Build HoldingWithPrice — raw DB fields are strings; parse to numbers.
  // name cannot be null in HoldingWithPrice; fall back to "".
  // changePercent is required; omit (undefined) when no quote available.
  const holdingsWithPrice: HoldingWithPrice[] = holdingsList.map((h) => {
    const quote = quoteMap[h.ticker];
    return {
      ticker: h.ticker,
      name: quote?.name ?? "",
      shares: parseFloat(h.shares),
      avgCostBasis: parseFloat(h.avgCostBasis),
      currentPrice: quote ? parseFloat(quote.price) : undefined,
      change: quote ? parseFloat(quote.change) : undefined,
      changePercent: quote ? parseFloat(quote.changePercent) : undefined,
    };
  });

  // Compute the three numeric props LivePortfolioDashboard requires
  const initialCashBalance = parseFloat(portfolio.cashBalance);
  const holdingsValue = holdingsWithPrice.reduce((sum, h) => {
    const price = h.currentPrice ?? h.avgCostBasis;
    return sum + h.shares * price;
  }, 0);
  const initialTotalValue = initialCashBalance + holdingsValue;

  return (
    <PortfolioDetailTabs
      portfolio={portfolio}
      initialHoldings={holdingsWithPrice}
      initialCashBalance={initialCashBalance}
      initialTotalValue={initialTotalValue}
      startingBalance={parseFloat(portfolio.startingBalance)}
    />
  );
}
```

### 5.2 `PortfolioDetailTabs` client component

**File:** `src/components/PortfolioDetailTabs.tsx`

> ⚠️ **Do NOT render a separate portfolio value/cash header** inside `PortfolioDetailTabs`. `LivePortfolioDashboard` already renders its own header with total portfolio value and cash balance. The tab switcher (Holdings | History) should sit above `LivePortfolioDashboard`'s content area — it must not duplicate the header that `LivePortfolioDashboard` already provides. The `/frontend-design` skill will handle exact layout, but the spec flags this explicitly to prevent double-rendering.

```tsx
"use client";

import { useState } from "react";
import { Portfolio } from "@/db/schema";
import { HoldingWithPrice } from "@/types";
import LivePortfolioDashboard from "@/components/LivePortfolioDashboard";
import PortfolioHistoryTab from "@/components/PortfolioHistoryTab";

type Tab = "holdings" | "history";

interface Props {
  portfolio: Portfolio;
  initialHoldings: HoldingWithPrice[];
  initialCashBalance: number;
  initialTotalValue: number;
  startingBalance: number;
}

export default function PortfolioDetailTabs({ portfolio, initialHoldings, initialCashBalance, initialTotalValue, startingBalance }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("holdings");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{portfolio.name}</h1>
        <p className="text-slate-400 text-sm mt-1">
          Cash: $
          {parseFloat(portfolio.cashBalance).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-slate-800/50 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab("holdings")}
          data-testid="tab-holdings"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "holdings"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          Holdings
        </button>
        <button
          onClick={() => setActiveTab("history")}
          data-testid="tab-history"
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "history"
              ? "bg-slate-700 text-white"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          History
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "holdings" && (
        <LivePortfolioDashboard
          portfolioId={portfolio.id}
          initialHoldings={initialHoldings}
          initialCashBalance={initialCashBalance}
          initialTotalValue={initialTotalValue}
          startingBalance={startingBalance}
        />
      )}
      {activeTab === "history" && (
        <PortfolioHistoryTab portfolioId={portfolio.id} />
      )}
    </div>
  );
}
```

---

## 6. `PortfolioHistoryTab` component

**File:** `src/components/PortfolioHistoryTab.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { TransactionRow } from "@/types/transactions";
import { cn } from "@/lib/utils";

interface Props {
  portfolioId: string;
}

// ─── Date grouping helpers ────────────────────────────────────────────────────

function getGroupLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface TransactionGroup {
  label: string;
  rows: TransactionRow[];
}

function groupByDate(rows: TransactionRow[]): TransactionGroup[] {
  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const label = getGroupLabel(new Date(row.executedAt));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(row);
  }
  return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }));
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PortfolioHistoryTab({ portfolioId }: Props) {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/portfolios/${portfolioId}/transactions`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load history");
        return res.json();
      })
      .then((data: TransactionRow[]) => setTransactions(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-slate-400 text-sm">Loading history…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-slate-400">No trades yet</p>
        <p className="text-slate-500 text-sm mt-1">
          Trades will appear here after your first buy or sell.
        </p>
      </div>
    );
  }

  const groups = groupByDate(transactions);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {group.label}
          </h3>
          <div className="space-y-2">
            {group.rows.map((tx) => (
              <TransactionRowItem key={tx.id} tx={tx} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Row item ─────────────────────────────────────────────────────────────────

function TransactionRowItem({ tx }: { tx: TransactionRow }) {
  const shares = parseFloat(tx.shares);
  const price = parseFloat(tx.pricePerShare);
  const total = parseFloat(tx.totalAmount);

  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4">
      {/* BUY/SELL badge */}
      <span
        className={cn(
          "text-xs font-bold px-2 py-1 rounded-md shrink-0",
          tx.type === "BUY"
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-red-500/20 text-red-400"
        )}
      >
        {tx.type}
      </span>

      {/* Ticker + detail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{tx.ticker}</span>
          <span className="text-slate-400 text-sm">
            {shares % 1 === 0 ? shares.toFixed(0) : shares.toFixed(4)} shares @ $
            {price.toFixed(2)}
          </span>
        </div>
        <div className="mt-1">
          {tx.pipelineName ? (
            <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">
              {tx.pipelineName}
            </span>
          ) : (
            <span className="text-xs text-slate-500">Manual</span>
          )}
        </div>
      </div>

      {/* Total + time */}
      <div className="text-right shrink-0">
        <div className="font-medium text-white">
          $
          {total.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
        <div className="text-xs text-slate-500">
          {new Date(tx.executedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
```

---

## 7. StockDetailSheet — "Your trades" section

**File:** `src/components/stock-detail/StockDetailSheet.tsx`

### 7.1 New imports

Add at the top of the file:

```ts
import { TransactionRow } from "@/types/transactions";
```

### 7.2 New state + effect

Inside the `StockDetailSheet` component function, alongside existing state declarations, add:

```ts
const [trades, setTrades] = useState<TransactionRow[]>([]);
const [tradesLoading, setTradesLoading] = useState(false);

useEffect(() => {
  // Only fetch trades when the sheet is open in the holdings context.
  // Skip for "search" and "builder" contexts where activePortfolioId
  // may be unrelated to what is displayed.
  if (!open || !activePortfolioId || context !== "holdings") return;
  setTradesLoading(true);
  fetch(`/api/portfolios/${activePortfolioId}/transactions?ticker=${ticker}`)
    .then((res) => (res.ok ? res.json() : Promise.resolve([])))
    .then((data: TransactionRow[]) => setTrades(data.slice(0, 10)))
    .catch(() => setTrades([]))
    .finally(() => setTradesLoading(false));
}, [open, ticker, activePortfolioId, context]);
```

`activePortfolioId` already comes from `useActivePortfolio()` which is already imported and used in this component.

### 7.3 "Your trades" JSX section

**Placement:** Add this block as a *sibling* to the Kronos forecast block, **outside** the `detailStatus === "success"` conditional guard. This mirrors the Kronos block pattern (`StockDetailSheet.tsx:1213-1235`) which renders independently of the detail fetch status. Do **not** nest it inside a `{detailStatus === "success" && (...)}` guard — it must render regardless of whether the stock detail fetch succeeded.

Add the block immediately after the Kronos forecast block, still within the sheet's scrollable content area and before the closing tag of that container:

```tsx
{/* ── Your trades ─────────────────────────────────────────────── */}
<div className="mt-6 px-1">
  <h3 className="text-sm font-semibold text-slate-300 mb-3">Your trades</h3>

  {tradesLoading ? (
    <p className="text-slate-500 text-sm">Loading…</p>
  ) : trades.length === 0 ? (
    <p className="text-slate-500 text-sm">No trades for this stock yet</p>
  ) : (
    <div className="space-y-0">
      {trades.map((tx) => {
        const sharesNum = parseFloat(tx.shares);
        const priceNum = parseFloat(tx.pricePerShare);
        const totalNum = parseFloat(tx.totalAmount);

        // P&L: only for SELL with costBasisAtSale present
        let pnl: number | null = null;
        if (tx.type === "SELL" && tx.costBasisAtSale != null) {
          const costBasis = parseFloat(tx.costBasisAtSale);
          pnl = (priceNum - costBasis) * sharesNum;
        }

        return (
          <div
            key={tx.id}
            className="flex items-center gap-3 py-2.5 border-b border-slate-700/50 last:border-0"
          >
            {/* Date */}
            <span className="text-xs text-slate-500 w-16 shrink-0">
              {new Date(tx.executedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>

            {/* BUY/SELL badge */}
            <span
              className={cn(
                "text-xs font-bold px-1.5 py-0.5 rounded shrink-0",
                tx.type === "BUY"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-red-500/20 text-red-400"
              )}
            >
              {tx.type}
            </span>

            {/* shares @ price */}
            <span className="text-xs text-slate-400 flex-1 min-w-0 truncate">
              {sharesNum % 1 === 0 ? sharesNum.toFixed(0) : sharesNum.toFixed(4)}{" "}
              @ ${priceNum.toFixed(2)}
            </span>

            {/* Total + P&L */}
            <div className="text-right shrink-0">
              <div className="text-xs text-slate-300">
                $
                {totalNum.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              {pnl != null && (
                <div
                  className={cn(
                    "text-xs font-medium",
                    pnl >= 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {pnl >= 0 ? "+" : "-"}$
                  {Math.abs(pnl).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
```

`cn` is already imported in StockDetailSheet.

### 7.4 P&L formula (canonical)

```
P&L = (pricePerShare − costBasisAtSale) × shares
```

- Show only when `tx.type === "SELL"` AND `tx.costBasisAtSale !== null`.
- Green (`text-emerald-400`) when `pnl >= 0`.
- Red (`text-red-400`) when `pnl < 0`.
- Display: `+$250.00` or `-$250.00` (always positive absolute value with explicit sign prefix).

---

## 8. Nav updates

### 8.1 `src/components/Sidebar.tsx`

Remove the History nav item from the nav links array:

```ts
// REMOVE:
{ href: "/history", label: "History", icon: Clock },
```

Remove `Clock` from the `lucide-react` import if it's no longer used elsewhere in the file.

### 8.2 `src/components/MobileNav.tsx`

Remove the History nav item:

```ts
// REMOVE:
{ href: "/history", label: "History", icon: Clock },
```

Remove `Clock` from the `lucide-react` import if no longer used.

### 8.3 `src/components/MobileTabBar.tsx`

Remove the History tab item:

```ts
// REMOVE:
{ href: "/history", label: "History", icon: Clock },
```

Remove `Clock` from the `lucide-react` import if no longer used.

### 8.4 `src/app/(dashboard)/history/page.tsx`

Replace the entire file content with:

```ts
import { redirect } from "next/navigation";

export default function HistoryPage() {
  redirect("/dashboard");
}
```

### 8.6 Portfolios list page — card links

**File:** `src/app/(dashboard)/portfolios/page.tsx`

The existing portfolios list page renders a card for each portfolio. Each card should link (or navigate) to `/portfolios/[id]` when clicked — this is the most natural entry point for users to reach the portfolio detail view and trade history.

Wrap the card or add a link button:

```tsx
import Link from "next/link";

// Wrap each portfolio card:
<Link href={`/portfolios/${portfolio.id}`}>
  {/* existing card content */}
</Link>
```

Or add a "View detail" / "View history" button inside the existing card UI — whichever fits the current card structure better. The key requirement is that a user on the portfolios list page can reach `/portfolios/[id]` with a single click.

### 8.5 Dashboard — "View detail" link

**File:** `src/app/(dashboard)/dashboard/page.tsx`

The dashboard page passes `portfolio` to `LivePortfolioDashboard`. Add a `portfolioDetailHref` prop or simply render a link in the dashboard page itself, below the `PortfolioSwitcher` / above `LivePortfolioDashboard`:

```tsx
import Link from "next/link";

// Add this just before or after the LivePortfolioDashboard render:
<div className="flex justify-end">
  <Link
    href={`/portfolios/${portfolio.id}`}
    className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
  >
    View detail →
  </Link>
</div>
```

Place it in a visually logical position — after the portfolio switcher, before the holdings list.

---

## 9. Tests

All tests in `tests/`. Follow Vitest + RTL patterns from the existing test files.

### 9.1 `tests/fixtures/factories.ts` — add transaction fixtures

Add to the existing factories file:

```ts
import type { Transaction } from "@/db/schema";

export const mockTransaction: Transaction = {
  id: "txn-uuid-1",
  portfolioId: "portfolio-uuid-1",
  ticker: "AAPL",
  type: "BUY",
  shares: "10.000000",
  pricePerShare: "150.0000",
  totalAmount: "1500.00",
  costBasisAtSale: null,
  pipelineId: null,
  executedAt: new Date("2026-06-01T14:30:00Z"),
};

export const mockSellTransaction: Transaction = {
  ...mockTransaction,
  id: "txn-uuid-2",
  type: "SELL",
  totalAmount: "1000.00",
  pricePerShare: "200.0000",
  shares: "5.000000",
  costBasisAtSale: "150.0000",
  pipelineId: "pipeline-uuid-1",
};
```

### 9.2 `tests/lib/trade-executor.test.ts` (new file)

Mock `@/db` so `db.transaction` calls the callback synchronously, exposing `tx` as a mock object. Follow the pattern from `tests/api/trade.test.ts`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTrade } from "@/lib/trade-executor";
import { db } from "@/db";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/lib/finnhub", () => ({
  getFinnhubClient: vi.fn(),
  fetchQuote: vi.fn(),
}));

// Helper: build a mock tx object
function makeTx(overrides?: Partial<Record<string, unknown>>) {
  const insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  const update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  const del = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  const select = vi.fn();
  return { insert, update, delete: del, select, ...overrides };
}

describe("executeTrade — pipelineId written to transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes pipelineId to transaction on BUY when provided", async () => {
    const tx = makeTx();
    // Mock tx.select chain for: portfolio, then existing holding (none)
    let selectCallCount = 0;
    tx.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // portfolio
              return [{ id: "p1", userId: "u1", cashBalance: "5000.00" }];
            }
            return []; // no existing holding
          }),
        }),
      }),
    }));

    vi.mocked(db.transaction).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(tx);
    });

    // Pre-supply price to skip Finnhub
    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "BUY",
      shares: 1,
      userId: "u1",
      price: 150,
      pipelineId: "pipeline-abc",
    });

    const insertValuesMock = tx.insert().values as ReturnType<typeof vi.fn>;
    const insertCall = insertValuesMock.mock.calls[0][0];
    expect(insertCall.pipelineId).toBe("pipeline-abc");
  });

  it("writes null pipelineId on BUY when not provided", async () => {
    // Similar setup; omit pipelineId from params
    // Assert tx.insert called with pipelineId: null
  });
});

describe("executeTrade — costBasisAtSale on SELL", () => {
  it("snapshots avgCostBasis from holding into costBasisAtSale", async () => {
    const tx = makeTx();
    let selectCallCount = 0;
    tx.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) {
              return [{ id: "p1", userId: "u1", cashBalance: "5000.00" }];
            }
            // existing holding with avgCostBasis
            return [{ id: "h1", portfolioId: "p1", ticker: "AAPL", shares: "10.000000", avgCostBasis: "142.5000" }];
          }),
        }),
      }),
    }));

    vi.mocked(db.transaction).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(tx);
    });

    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "SELL",
      shares: 5,
      userId: "u1",
      price: 200,
    });

    const insertValuesMock = tx.insert().values as ReturnType<typeof vi.fn>;
    const insertCall = insertValuesMock.mock.calls[0][0];
    expect(insertCall.costBasisAtSale).toBe("142.5000");
  });

  it("costBasisAtSale is null for BUY", async () => {
    // Same pattern; type: "BUY"
    // Assert costBasisAtSale: null in insert call
  });

  it("snapshots costBasisAtSale even when full position is sold (holding deleted)", async () => {
    // Mock: existingShares === shares to be sold → triggers tx.delete
    // Assert costBasisAtSale still present in tx.insert call
  });
});
```

**Note:** The test stubs above show the pattern. Fill in the "Similar setup" stubs with the same mock pattern to complete the suite.

### 9.3 `tests/api/portfolios-id-transactions.test.ts` (new file)

```ts
import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockSession, mockTransaction } from "../fixtures/factories";

import * as handler from "@/app/api/portfolios/[id]/transactions/route";

vi.mock("@/auth");
vi.mock("@/db");

function setupAuth(authed = true) {
  vi.mocked(auth).mockResolvedValue(authed ? (mockSession as any) : null);
}

describe("GET /api/portfolios/[id]/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    setupAuth(false);
    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when user not found in DB", async () => {
    setupAuth();
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/user not found/i);
      },
    });
  });

  it("returns 404 when portfolio not owned by authenticated user", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return []; // portfolio not found / not owned
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      params: { id: "other-portfolio-id" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 200 with array of transactions for valid owned portfolio", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    // Mock db.query.transactions.findMany
    vi.mocked(db).query = {
      transactions: {
        findMany: vi.fn().mockResolvedValue([
          { ...mockTransaction, pipeline: null },
        ]),
      },
    } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect(json[0]).toMatchObject({
          id: mockTransaction.id,
          ticker: mockTransaction.ticker,
          type: mockTransaction.type,
          pipelineName: null,
        });
      },
    });
  });

  it("normalizes ?ticker=nvda to NVDA uppercase", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    const findMany = vi.fn().mockResolvedValue([]);
    vi.mocked(db).query = { transactions: { findMany } } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        await fetch({ method: "GET", url: `?ticker=nvda` });
        // Confirm the findMany where condition references "NVDA" (uppercased).
        // The API normalizes `?ticker=nvda` → "NVDA" before building the Drizzle
        // `eq(transactions.ticker, tickerFilter)` call. Check the actual value
        // captured in the mock rather than serializing Drizzle AST nodes.
        const callArgs = findMany.mock.calls[0][0];
        // Walk the `where` condition to find the right-hand value of the eq() call
        // that filters on ticker. The Drizzle `eq` node stores the value in
        // `callArgs.where.value` or equivalent; alternatively, assert by checking
        // that findMany was called and re-fetching with a known uppercase ticker:
        expect(findMany).toHaveBeenCalledOnce();
        // The where arg must contain an eq condition whose string value is "NVDA"
        // (not "nvda"). Inspect the right-hand side of the `and(…, eq(…, value))`
        // — for the Drizzle SQL builder the leaf value is accessible at:
        // callArgs.where.right.value  OR  callArgs.where.chunks[1].value.value
        // Use whichever path matches the Drizzle version in use; a helper:
        const whereStr = JSON.stringify(callArgs.where ?? callArgs);
        expect(whereStr).toContain('"NVDA"');
        expect(whereStr).not.toContain('"nvda"');
      },
    });
  });

  it("includes pipelineName from joined pipeline", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    vi.mocked(db).query = {
      transactions: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...mockTransaction,
            pipelineId: "pipeline-uuid-1",
            pipeline: { id: "pipeline-uuid-1", name: "Kronos Pure Signal" },
          },
        ]),
      },
    } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        const json = await res.json();
        expect(json[0].pipelineName).toBe("Kronos Pure Signal");
      },
    });
  });

  it("returns pipelineName: null for manual trades", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    vi.mocked(db).query = {
      transactions: {
        findMany: vi.fn().mockResolvedValue([
          { ...mockTransaction, pipelineId: null, pipeline: null },
        ]),
      },
    } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        const json = await res.json();
        expect(json[0].pipelineName).toBeNull();
      },
    });
  });
});
```

### 9.4 `tests/components/PortfolioHistoryTab.test.tsx` (new file)

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PortfolioHistoryTab from "@/components/PortfolioHistoryTab";
import { TransactionRow } from "@/types/transactions";

global.fetch = vi.fn();

const today = new Date();
const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const mockBuy: TransactionRow = {
  id: "t1",
  ticker: "AAPL",
  type: "BUY",
  shares: "10.000000",
  pricePerShare: "150.0000",
  totalAmount: "1500.00",
  costBasisAtSale: null,
  executedAt: today,
  pipelineId: null,
  pipelineName: null,
};

const mockSell: TransactionRow = {
  id: "t2",
  ticker: "NVDA",
  type: "SELL",
  shares: "5.000000",
  pricePerShare: "800.0000",
  totalAmount: "4000.00",
  costBasisAtSale: "600.0000",
  executedAt: twoDaysAgo,
  pipelineId: "p1",
  pipelineName: "Kronos Pure Signal",
};

describe("PortfolioHistoryTab", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it("shows loading state initially", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<PortfolioHistoryTab portfolioId="p1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows empty state when no transactions returned", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => expect(screen.getByText(/no trades yet/i)).toBeInTheDocument());
  });

  it("groups today's trades under 'Today'", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument());
  });

  it("does not label older trades as 'Today'", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockSell] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
    });
  });

  it("renders BUY badge with emerald color", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      const badge = screen.getByText("BUY");
      expect(badge.className).toMatch(/emerald/);
    });
  });

  it("renders SELL badge with red color", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockSell] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      const badge = screen.getByText("SELL");
      expect(badge.className).toMatch(/red/);
    });
  });

  it("renders pipeline chip for pipeline-attributed trade", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockSell] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("Kronos Pure Signal")).toBeInTheDocument();
    });
  });

  it("renders 'Manual' label for trades without pipeline", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("Manual")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load history/i)).toBeInTheDocument();
    });
  });

  it("renders ticker and shares for each row", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("AAPL")).toBeInTheDocument();
    });
  });
});
```

### 9.5 `tests/components/StockDetailSheet.test.tsx` — add "Your trades" describe block

**Do not modify existing tests.** Add a new `describe` block at the bottom of the file.

**Required test setup for all tests in this describe block:**
- Wrap the rendered component in `<ActivePortfolioContext>` (or its provider) with a mocked `activePortfolioId` (e.g. `"portfolio-uuid-1"`) so the `useActivePortfolio()` hook returns a non-null value.
- Always render with `open={true}` so the sheet is visible.
- Pass `context="holdings"` — the fetch effect will not fire for `"search"` or `"builder"` contexts per the guard added in §7.2.
- Use the existing render helper from this file if one is available, or render `<StockDetailSheet>` directly with the required props wrapped in the provider.

```tsx
import { TransactionRow } from "@/types/transactions";

// At the bottom of the existing test file:

describe("StockDetailSheet — Your trades section", () => {
  const mockTrades: TransactionRow[] = [
    {
      id: "t1",
      ticker: "AAPL",
      type: "BUY",
      shares: "10.000000",
      pricePerShare: "150.0000",
      totalAmount: "1500.00",
      costBasisAtSale: null,
      executedAt: new Date("2026-06-01T10:00:00Z"),
      pipelineId: null,
      pipelineName: null,
    },
    {
      id: "t2",
      ticker: "AAPL",
      type: "SELL",
      shares: "5.000000",
      pricePerShare: "200.0000",
      totalAmount: "1000.00",
      costBasisAtSale: "150.0000",
      executedAt: new Date("2026-06-10T14:00:00Z"),
      pipelineId: null,
      pipelineName: null,
    },
  ];

  function setupFetch(trades: TransactionRow[]) {
    vi.mocked(global.fetch).mockImplementation((url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/transactions")) {
        return Promise.resolve({ ok: true, json: async () => trades } as any);
      }
      return Promise.resolve({ ok: false, json: async () => ({}) } as any);
    });
  }

  it("renders 'Your trades' heading when open", async () => {
    setupFetch(mockTrades);
    // Render sheet open for AAPL with the holdings context
    // (use existing render helper from this file or render directly)
    await waitFor(() => {
      expect(screen.getByText("Your trades")).toBeInTheDocument();
    });
  });

  it("shows 'No trades for this stock yet' when trades array is empty", async () => {
    setupFetch([]);
    await waitFor(() => {
      expect(screen.getByText(/no trades for this stock yet/i)).toBeInTheDocument();
    });
  });

  it("calculates P&L for SELL: (200 - 150) * 5 = +$250.00", async () => {
    setupFetch(mockTrades);
    await waitFor(() => {
      expect(screen.getByText("+$250.00")).toBeInTheDocument();
    });
    const pnlEl = screen.getByText("+$250.00");
    expect(pnlEl.className).toMatch(/emerald/);
  });

  it("does not render P&L for BUY rows", async () => {
    setupFetch([mockTrades[0]]); // BUY only
    await waitFor(() => {
      expect(screen.getByText("BUY")).toBeInTheDocument();
    });
    // P&L element should not appear for BUY
    expect(screen.queryByText(/\+\$/)).not.toBeInTheDocument();
  });

  it("does not render P&L when costBasisAtSale is null on SELL", async () => {
    const sellNoCost: TransactionRow[] = [
      { ...mockTrades[1], costBasisAtSale: null },
    ];
    setupFetch(sellNoCost);
    await waitFor(() => {
      expect(screen.getByText("SELL")).toBeInTheDocument();
    });
    // No P&L shown
    expect(screen.queryByText(/\+\$|−\$/)).not.toBeInTheDocument();
  });

  it("shows P&L in red for a losing SELL", async () => {
    const losingTrades: TransactionRow[] = [
      {
        ...mockTrades[1],
        pricePerShare: "100.0000",    // sold at $100
        costBasisAtSale: "150.0000",  // bought at $150 → loss
        totalAmount: "500.00",
        shares: "5.000000",
      },
    ];
    setupFetch(losingTrades);
    // P&L = (100 - 150) * 5 = -$250.00
    await waitFor(() => {
      const pnlEl = screen.getByText("-$250.00");
      expect(pnlEl).toBeInTheDocument();
      expect(pnlEl.className).toMatch(/red/);
    });
  });
});
```

---

## 10. Implementation order (execute sequentially)

1. `drizzle/0005_buy_sell_history.sql` — write migration SQL; also update `drizzle/meta/_journal.json` (add idx:5 entry) and create `drizzle/meta/0005_snapshot.json` (copy from 0004, add new columns)
2. `src/db/schema.ts` — add columns to `transactions`, update `transactionsRelations`, update `pipelinesRelations`
3. `src/types/transactions.ts` — create `TransactionRow` type
4. `tests/fixtures/factories.ts` — add `mockTransaction`, `mockSellTransaction`
5. `src/lib/trade-executor.ts` — add `pipelineId` param, capture `costBasisAtSale`, update insert
6. `src/app/api/pipeline/run/route.ts` — pass `pipelineId` to both `executeTrade` calls
7. `src/app/api/portfolios/[id]/transactions/route.ts` — create new GET route
8. `src/components/PortfolioHistoryTab.tsx` — create component
9. `src/components/PortfolioDetailTabs.tsx` — create component
10. `src/app/(dashboard)/portfolios/[id]/page.tsx` — create page
11. `src/components/stock-detail/StockDetailSheet.tsx` — add trades state + "Your trades" JSX
12. `src/components/Sidebar.tsx` — remove History link
13. `src/components/MobileNav.tsx` — remove History link
14. `src/components/MobileTabBar.tsx` — remove History tab
15. `src/app/(dashboard)/history/page.tsx` — replace with redirect
16. `src/app/(dashboard)/dashboard/page.tsx` — add "View detail →" link
17. `tests/lib/trade-executor.test.ts` — write unit tests
18. `tests/api/portfolios-id-transactions.test.ts` — write API route tests
19. `tests/components/PortfolioHistoryTab.test.tsx` — write component tests
20. `tests/components/StockDetailSheet.test.tsx` — append "Your trades" describe block

---

## 11. Edge cases & invariants

| Case | Expected behavior |
|---|---|
| Pipeline deleted after trade | FK `ON DELETE SET NULL` clears `pipelineId`; `pipelineName` returns `null` in API |
| Full sell (holding goes to zero) | `costBasisAtSale` captured from holding BEFORE `tx.delete`; holding removed after |
| Partial sell | `costBasisAtSale` = `avgCostBasis` at sell time; remaining holding keeps same avg |
| BUY trade | `costBasisAtSale` is always `null` |
| `?ticker=` lowercase | Normalized to uppercase in API before DB query |
| `/history` direct navigation | Redirects to `/dashboard` — no 404 |
| Portfolio not owned by user | API returns 404 (not 403) to prevent ID enumeration |
| No trades for portfolio | Empty state shown — not an error condition |
| Fetch error in `PortfolioHistoryTab` | Error message shown inline; no throw |
| Fetch error in StockDetailSheet trades | Silently sets trades to `[]`, shows empty state message |
| `costBasisAtSale` is null on a SELL (legacy rows pre-migration) | P&L calculation skipped; no P&L display in "Your trades" |

---

## 12. Files changed / created summary

### New files
- `drizzle/0005_buy_sell_history.sql`
- `drizzle/meta/0005_snapshot.json`
- `src/app/api/portfolios/[id]/transactions/route.ts`
- `src/app/(dashboard)/portfolios/[id]/page.tsx`
- `src/components/PortfolioDetailTabs.tsx`
- `src/components/PortfolioHistoryTab.tsx`
- `src/types/transactions.ts`
- `tests/lib/trade-executor.test.ts`
- `tests/api/portfolios-id-transactions.test.ts`
- `tests/components/PortfolioHistoryTab.test.tsx`

### Modified files
- `drizzle/meta/_journal.json` — append idx:5 entry for 0005_buy_sell_history
- `src/db/schema.ts` — transactions table columns + transactionsRelations + pipelinesRelations
- `src/lib/trade-executor.ts` — pipelineId param, costBasisAtSale capture, updated insert
- `src/app/api/pipeline/run/route.ts` — pass pipelineId to executeTrade (×2)
- `src/components/Sidebar.tsx` — remove History nav item
- `src/components/MobileNav.tsx` — remove History nav item
- `src/components/MobileTabBar.tsx` — remove History tab item
- `src/app/(dashboard)/history/page.tsx` — replace with redirect to /dashboard
- `src/app/(dashboard)/dashboard/page.tsx` — add "View detail →" link to /portfolios/[id]
- `src/components/stock-detail/StockDetailSheet.tsx` — add trades state + "Your trades" section
- `tests/fixtures/factories.ts` — add mockTransaction, mockSellTransaction
- `tests/components/StockDetailSheet.test.tsx` — append "Your trades" describe block

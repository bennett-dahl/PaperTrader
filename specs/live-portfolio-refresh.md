# Spec: Live Portfolio Value with 5-Minute Auto-Refresh

## Goal
After buying stocks (e.g. via Portfolio Builder), the dashboard should immediately reflect live prices — not stale DB cache snapshots. Every 5 minutes, all held tickers are re-quoted from Finnhub and the portfolio value recalculates automatically client-side.

---

## Background / Current State

- `dashboard/page.tsx` is a pure **Server Component**. It queries the `holdings` table and `cachedQuotes` DB table server-side, computes `totalValue = sum(shares × cachedPrice) + cashBalance`, and passes it down as static props.
- `GET /api/quotes?tickers=AAPL,MSFT` — **already exists**. Checks DB cache; for stale entries (>5min), fires Finnhub refresh as fire-and-forget and returns cached value. Returns `{ quotes: { [ticker]: { price, change, changePercent, stale } } }`.
- No client-side holdings route exists yet.
- No live refresh loop exists anywhere.

---

## What to Build

### 1. New API Route: `GET /api/holdings`

**File:** `src/app/api/holdings/route.ts`

- Auth-gated (requires session, same pattern as other routes)
- Query param: `portfolioId` (required)
- Verify the portfolio belongs to the current user (security check)
- Return the holdings + portfolio cash balance:

```ts
{
  holdings: Array<{
    ticker: string
    name: string        // from cachedQuotes or a fallback
    shares: number
    avgCostBasis: number
  }>,
  cashBalance: number
}
```

- Get `name` from `cachedQuotes` table (join on ticker). If no cached quote exists for a ticker, use "" as fallback for name.

---

### 2. New Client Component: `<LivePortfolioDashboard>`

**File:** `src/components/LivePortfolioDashboard.tsx`

This is a "use client" component that wraps the dashboard's live-value section. The SSR page passes it initial data as props so there's no loading flash on first render.

**Props:**
```ts
interface LivePortfolioDashboardProps {
  portfolioId: string
  initialHoldings: HoldingWithPrice[]   // SSR-hydrated, prices from cachedQuotes
  initialCashBalance: number
  initialTotalValue: number
}
```

**Internal state:**
- holdings, cashBalance, liveQuotes map, lastUpdated, isRefreshing

**Live value calculation:**
- totalValue = sum(shares × livePrice ?? cachedPrice ?? avgCostBasis) + cashBalance (via useMemo)

**Refresh logic (refreshQuotes function):**
1. Get tickers from current holdings
2. Chunk into batches of 10
3. For each batch: fetch /api/quotes?tickers=T1,T2,..., await, merge into liveQuotes state
4. Stagger batches with 500ms delay between them
5. After all batches: set lastUpdated, isRefreshing = false

**Auto-refresh timer:**
- useEffect: call refreshQuotes immediately on mount, then setInterval every 5 minutes

**Re-fetch holdings on portfolio change:**
- useEffect on portfolioId: fetch /api/holdings?portfolioId=X, update holdings + cashBalance state

**Render:** Renders PortfolioCard (with live totalValue) and holdings list (HoldingRow for each).
Show a small "last updated X min ago" timestamp below portfolio value.
Show subtle spinner while isRefreshing.

---

### 3. Update `dashboard/page.tsx`

1. Keep server-side data fetching for initial render
2. Build initialHoldings (with currentPrice from cachedQuotes) and initialCashBalance
3. Replace static PortfolioCard + holdings list with <LivePortfolioDashboard> receiving those as props

---

### 4. Minor: Add `name` to `/api/quotes` response (if missing)

Check the existing /api/quotes response. If name is not included, add it from cachedQuotes.name.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/app/api/holdings/route.ts` | **Create** |
| `src/components/LivePortfolioDashboard.tsx` | **Create** |
| `src/app/(dashboard)/dashboard/page.tsx` | **Modify** |
| `src/app/api/quotes/route.ts` | **Check** — add name to response if missing |

---

## Constraints & Notes

- Rate limits: Finnhub free = 60 req/min. Chunk into batches of 10 with 500ms stagger.
- Market hours: stale flag from /api/quotes is sufficient. No blocking behavior needed.
- StockDetailSheet fetches its own quote independently — no changes needed.
- No changes to ActivePortfolioContext — live refresh uses SSR-resolved portfolioId as source of truth.
- Don't break the SSR path — initial render must still work (hydration).
- TypeScript: add HoldingWithPrice type to shared types file if missing.

---

## Definition of Done

- [ ] Dashboard shows live Finnhub prices immediately on load (not just DB cache)
- [ ] Portfolio value recalculates after each refresh cycle
- [ ] Auto-refreshes every 5 minutes
- [ ] Staggered batch fetching — max 10 tickers per call, 500ms between batches
- [ ] "Last updated" timestamp visible below portfolio value
- [ ] No loading flash on initial render (SSR hydration still works)
- [ ] Build passes (npm run build)

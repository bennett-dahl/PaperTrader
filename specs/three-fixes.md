# Spec: Three UI Fixes

## Fix 1: Y-Axis Min/Max on Price Charts

**File:** `src/components/PriceChart.tsx` (or wherever the Recharts chart is rendered)

**Goal:** Show only the min and max price values on the Y-axis for the visible candle range. Keep it clean — no gridlines or intermediate ticks.

**Implementation:**
- From the candles data, calculate:
  ```ts
  const prices = candles.map(c => c.close)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const padding = (max - min) * 0.05  // 5% buffer so line doesn't hug edges
  ```
- Set `<YAxis domain={[min - padding, max + padding]} ticks={[min, max]} />`
- Format tick values as currency: `$123.45` (2 decimal places)
- If `tickFormatter` is already set, update it. If YAxis was hidden (`hide={true}` or `width={0}`), enable it with a small width (e.g. `width={60}`)
- Keep the axis on the right side (`orientation="right"`) if that fits the design, otherwise left is fine

---

## Fix 2: Force Live Price Fetch on Dashboard Load

**Problem:** `/api/quotes` returns stale DB cache immediately and fires Finnhub as fire-and-forget. So on first load, `refreshQuotes()` in `LivePortfolioDashboard` gets back old prices and the portfolio value looks unchanged.

**File:** `src/app/api/quotes/route.ts` + `src/components/LivePortfolioDashboard.tsx`

**Option A (preferred) — Add `?force=true` param to quotes route:**

In `route.ts`:
- If `searchParams.get("force") === "true"`, await the Finnhub fetch synchronously instead of fire-and-forget for stale tickers
- Still return immediately for fresh tickers (within TTL)
- Update the DB cache with the fresh price before responding

In `LivePortfolioDashboard.tsx`:
- First call on mount: `fetch(/api/quotes?tickers=...&force=true)` — waits for live prices
- Subsequent interval refreshes: normal `fetch(/api/quotes?tickers=...)` — fine to use cache

---

## Fix 3: "New Portfolio" Button in Portfolio Switcher

**Goal:** Surface the Portfolio Builder wizard (`/build`) from the dashboard so users can create additional portfolios.

**Where:** Find the portfolio switcher component on the dashboard (likely in `LivePortfolioDashboard.tsx` or a separate `PortfolioSwitcher` component). 

**Implementation:**
- Add a "＋ New Portfolio" button/option at the bottom of the portfolio switcher dropdown (or next to it if it's not a dropdown)
- Clicking it navigates to `/build` using Next.js `router.push('/build')` or a plain `<Link href="/build">`
- Style it to match the existing UI — subtle, secondary style so it doesn't compete with the main content
- If there are no portfolios at all (empty state), show a more prominent CTA: "Create your first portfolio →" linking to `/build`

---

## After implementing all three:
1. Run `npm run build`
2. Fix any TypeScript errors
3. Confirm clean build

## Report:
- Files changed
- Build status
- Any tradeoffs or decisions made

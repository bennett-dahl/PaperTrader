# PaperTrader Test Suite Spec

**Status:** Planning  
**Target Framework:** Vitest + React Testing Library  
**Author:** Spec generated 2026-05-27

---

## 1. Overview

This document is a developer-ready specification for adding a complete test suite to PaperTrader. A developer should be able to start immediately from Section 3 and have a green CI run without referencing any other doc.

**Scope:**

| Layer | Coverage target |
|---|---|
| Utility functions | 100% |
| API route handlers | Happy path + all error branches |
| React hooks | All state transitions |
| React components | Render, interaction, edge cases |
| Auth gates | Every protected route returns 401 w/ no session |
| CI | GitHub Actions, coverage to console |

**Key constraints:**
- No real Finnhub calls, no real DB, no real auth in tests
- All external calls mocked at module boundary
- `next-test-api-route-handler` (ntarh) for all API route tests
- `jsdom` environment for components/hooks

---

## 2. Pre-Test Refactors

These must be completed **before** tests are written. The test cases in this spec assume they are done.

### 2.1 Extract `suggest-utils.ts`

**From:** `src/app/api/suggest/route.ts`  
**To:** `src/lib/suggest-utils.ts`

Move and export:
- `buildAllocations(tickers, stocks, totalAmount)` — currently private async function
- `getPrices(tickers)` — currently private async function
- `SuggestionItem` interface — currently exported from route file, move here

The route file imports and calls these instead of defining them inline.

```ts
// src/lib/suggest-utils.ts
import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";
import { featureFlags } from "@/lib/featureFlags";

export interface SuggestionItem {
  ticker: string;
  name: string;
  sector: string;
  category: string;
  riskLevel: string;
  marketCap: string;
  description: string | null;
  price: number;
  shares: number;
  allocatedAmount: number;
}

export async function getPrices(tickers: string[]): Promise<Record<string, number>> { ... }
export async function buildAllocations(
  tickers: string[],
  stocks: Array<{
    ticker: string; name: string; sector: string; category: string;
    riskLevel: string; marketCap: string; description: string | null
  }>,
  totalAmount: number
): Promise<SuggestionItem[]> { ... }
```

### 2.2 Extract `portfolio-utils.ts`

**From:** `src/components/HoldingRow.tsx` (inline math) and any inline math in `PositionBanner` (once extracted)  
**To:** `src/lib/portfolio-utils.ts`

Export pure functions:

```ts
// src/lib/portfolio-utils.ts

/** Total current value of a holding */
export function holdingCurrentValue(shares: number, currentPrice: number): number

/** Cost basis of a holding */
export function holdingCostBasis(shares: number, avgCostBasis: number): number

/** Absolute gain/loss in dollars */
export function holdingGainLoss(shares: number, currentPrice: number, avgCostBasis: number): number

/** Gain/loss as percentage (returns 0 if costBasis is 0) */
export function holdingGainLossPct(shares: number, currentPrice: number, avgCostBasis: number): number

/** Total portfolio value: cash + sum of all holding current values */
export function portfolioTotalValue(
  cashBalance: number,
  holdings: Array<{ shares: number; currentPrice: number }>
): number

/** Portfolio P&L vs starting balance */
export function portfolioPnL(totalValue: number, startingBalance: number): number

/** Portfolio P&L percentage */
export function portfolioPnLPct(totalValue: number, startingBalance: number): number
```

### 2.3 Extract `TradePanel.tsx`

**From:** `src/components/TradeSheet.tsx` — the inner form (trade type tabs, shares input, cost preview, submit button)  
**To:** `src/components/TradePanel.tsx`

Props interface:
```ts
interface TradePanelProps {
  ticker: string;
  portfolioId: string;
  quote: { price: number; changePercent: number } | null;
  quoteLoading: boolean;
  onSuccess?: () => void;
}
```

`TradeSheet` remains and wraps `TradePanel` inside the Sheet shell.

### 2.4 Extract `PositionBanner.tsx`

**From:** the holdings summary banner currently inline in `src/app/(dashboard)/dashboard/page.tsx` or similar  
**To:** `src/components/PositionBanner.tsx`

Props:
```ts
interface PositionBannerProps {
  cashBalance: number;
  startingBalance: number;
  holdingsValue: number;
}
```

Uses functions from `portfolio-utils.ts` for total value, P&L, and P&L%.

### 2.5 Add handler-level `auth()` to five routes

The following routes currently call `fetch` directly without auth. Add `auth()` guard at the top of each handler:

| File | Handler(s) |
|---|---|
| `src/app/api/stock-detail/[ticker]/route.ts` | `GET` |
| `src/app/api/stock/candles/[ticker]/route.ts` | `GET` |
| `src/app/api/stock/news/[ticker]/route.ts` | `GET` |
| `src/app/api/quotes/route.ts` | `GET` |
| `src/app/api/search/route.ts` | `GET` |

Pattern to add at top of each handler:
```ts
const session = await auth();
if (!session?.user?.email) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

---

## 3. Dependencies

```bash
npm install -D \
  vitest \
  @vitejs/plugin-react \
  @testing-library/react \
  @testing-library/user-event \
  @testing-library/jest-dom \
  next-test-api-route-handler \
  @vitest/coverage-v8 \
  jsdom \
  msw
```

> `msw` is optional but recommended for component-level fetch mocking.  
> `next-test-api-route-handler` requires `next` >= 13 (App Router support confirmed in v4+).

---

## 4. `vitest.config.ts`

Create at repo root (alongside `next.config.ts`):

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],  // console output only
      include: [
        "src/lib/**/*.ts",
        "src/app/api/**/*.ts",
        "src/hooks/**/*.ts",
        "src/components/**/*.tsx",
      ],
      exclude: [
        "src/components/ui/**",        // shadcn primitives, not our logic
        "src/db/**",
        "src/app/layout.tsx",
        "src/app/page.tsx",
        "src/middleware.ts",
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 65,
      },
    },
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Add to `package.json` scripts:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## 5. `tests/setup.ts` — Global Setup

```ts
// tests/setup.ts
import "@testing-library/jest-dom";
import { vi, beforeEach, afterEach } from "vitest";

// ─── localStorage mock ──────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

beforeEach(() => {
  localStorageMock.clear();
});

// ─── Auth mock — module-level, refined per test ────────────────────────────
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// ─── DB mock — module-level ─────────────────────────────────────────────────
vi.mock("@/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    selectDistinct: vi.fn().mockReturnThis(),
  },
}));

// ─── Finnhub mock ───────────────────────────────────────────────────────────
vi.mock("@/lib/finnhub", () => ({
  getFinnhubClient: vi.fn(() => ({})),
  fetchQuote: vi.fn(),
  searchSymbols: vi.fn(),
}));

// ─── Feature flags mock ─────────────────────────────────────────────────────
vi.mock("@/lib/featureFlags", () => ({
  featureFlags: {
    SUGGEST_FORCE_FRESH_PRICES: false,
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});
```

---

## 6. Test Directory Structure

```
tests/
├── setup.ts
├── fixtures/
│   └── factories.ts               # shared test data factories
├── lib/
│   ├── suggest-utils.test.ts
│   └── portfolio-utils.test.ts
├── api/
│   ├── auth-gate.test.ts          # batch 401 tests for all protected routes
│   ├── trade.test.ts
│   ├── portfolio.test.ts
│   ├── suggest.test.ts
│   ├── suggest-execute.test.ts
│   ├── suggest-swap.test.ts
│   ├── presets.test.ts
│   ├── presets-id.test.ts
│   ├── watchlist.test.ts
│   ├── watchlist-ticker.test.ts
│   ├── stock-detail.test.ts
│   ├── candles.test.ts
│   ├── news.test.ts
│   ├── quotes.test.ts
│   ├── search.test.ts
│   ├── cron-refresh-quotes.test.ts
│   └── cron-snapshot.test.ts
├── hooks/
│   ├── useWatchlist.test.ts
│   └── useSwipeToDismiss.test.ts
└── components/
    ├── TradePanel.test.tsx
    ├── PositionBanner.test.tsx
    ├── HoldingRow.test.tsx
    ├── StockDetailSheet.test.tsx
    ├── PresetsPanel.test.tsx
    └── builder/
        ├── Step1Config.test.tsx
        ├── Step2Suggestions.test.tsx
        └── Step3Confirm.test.tsx
```

---

## 7. Mocking Strategy Details

### 7.1 DB Mock Shape

The global `db` mock (in `setup.ts`) uses a fluent builder chain. Tests override terminal methods per case.

```ts
// Example: mock a .select().from().where().limit() chain that resolves to rows
import { db } from "@/db";

vi.mocked(db.select).mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([mockUser]),
    }),
  }),
} as any);
```

> **Note:** Drizzle's chained API makes the mock shape deeply nested. Cast to `any` inside tests. Use the `mockDbChain(finalValue)` helper from `factories.ts`.

```ts
// tests/fixtures/factories.ts
export function mockDbSelect(finalValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(finalValue),
        orderBy: vi.fn().mockResolvedValue(finalValue),
      }),
      orderBy: vi.fn().mockResolvedValue(finalValue),
    }),
  };
}

export function mockDbInsert(returningValue: unknown) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returningValue),
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returningValue),
      }),
    }),
  };
}
```

### 7.2 Finnhub Mock Shape

```ts
import { fetchQuote, searchSymbols } from "@/lib/finnhub";

// Quote
vi.mocked(fetchQuote).mockResolvedValue({ c: 150.0, d: 1.5, dp: 1.01 });

// Search
vi.mocked(searchSymbols).mockResolvedValue([
  { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
]);

// No data
vi.mocked(fetchQuote).mockResolvedValue(null);
```

### 7.3 Auth Mock Pattern

```ts
import { auth } from "@/auth";

// Authenticated
vi.mocked(auth).mockResolvedValue({
  user: { email: "test@example.com", name: "Test User" },
} as any);

// Unauthenticated
vi.mocked(auth).mockResolvedValue(null);
```

### 7.4 `next-test-api-route-handler` (ntarh) Usage

```ts
import { testApiHandler } from "next-test-api-route-handler";
import * as handler from "@/app/api/trade/route";

it("POST /api/trade -> 401 when unauthenticated", async () => {
  vi.mocked(auth).mockResolvedValue(null);

  await testApiHandler({
    appHandler: handler,
    test: async ({ fetch }) => {
      const res = await fetch({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: "AAPL", type: "BUY", shares: 1, portfolioId: "p1" }),
      });
      expect(res.status).toBe(401);
    },
  });
});
```

For dynamic routes (e.g., `[ticker]`, `[id]`), pass `params`:
```ts
await testApiHandler({
  appHandler: handler,
  params: { ticker: "AAPL" },
  test: async ({ fetch }) => { ... },
});
```

### 7.5 Cron Routes (Bearer Auth)

Cron routes use `Authorization: Bearer <CRON_SECRET>`, not session auth.

```ts
process.env.CRON_SECRET = "test-secret";

await testApiHandler({
  appHandler: handler,
  test: async ({ fetch }) => {
    const res = await fetch({
      headers: { authorization: "Bearer test-secret" },
    });
    expect(res.status).toBe(200);
  },
});
```

---

## 8. Test Fixtures / Factories

```ts
// tests/fixtures/factories.ts
import { vi } from "vitest";
import type {
  User, Portfolio, Holding, Transaction,
  WatchlistItem, PortfolioBuilderPreset, StockUniverse, CachedQuote
} from "@/db/schema";

// ─── Users ───────────────────────────────────────────────────────────────────
export const mockUser: User = {
  id: "user-uuid-1",
  email: "test@example.com",
  name: "Test User",
  image: null,
  createdAt: new Date("2025-01-01"),
};

// ─── Portfolios ───────────────────────────────────────────────────────────────
export const mockPortfolio: Portfolio = {
  id: "portfolio-uuid-1",
  userId: "user-uuid-1",
  name: "My Portfolio",
  startingBalance: "5000.00",
  cashBalance: "3000.00",
  createdAt: new Date("2025-01-01"),
  isDefault: true,
};

export const mockEmptyPortfolio: Portfolio = {
  ...mockPortfolio,
  id: "portfolio-uuid-2",
  cashBalance: "5000.00",
};

// ─── Holdings ─────────────────────────────────────────────────────────────────
export const mockHolding: Holding = {
  id: "holding-uuid-1",
  portfolioId: "portfolio-uuid-1",
  ticker: "AAPL",
  shares: "10.0000",
  avgCostBasis: "150.0000",
  createdAt: new Date("2025-02-01"),
};

// ─── Cached Quotes ────────────────────────────────────────────────────────────
export const mockCachedQuote: CachedQuote = {
  ticker: "AAPL",
  name: "Apple Inc.",
  price: "175.00",
  change: "2.00",
  changePercent: "1.16",
  updatedAt: new Date(), // fresh
};

export const mockStaleCachedQuote: CachedQuote = {
  ...mockCachedQuote,
  updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10min ago stale
};

// ─── Stock Universe ───────────────────────────────────────────────────────────
export const mockStockUniverse: StockUniverse = {
  id: "stock-uuid-1",
  ticker: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  category: "Technology",
  riskLevel: "low",
  marketCap: "large",
  description: "Makes iPhones.",
  createdAt: new Date("2025-01-01"),
};

export const mockHighRiskStock: StockUniverse = {
  ...mockStockUniverse,
  id: "stock-uuid-2",
  ticker: "GME",
  name: "GameStop Corp.",
  sector: "Consumer Cyclical",
  category: "Retail",
  riskLevel: "high",
  marketCap: "small",
};

// ─── Presets ──────────────────────────────────────────────────────────────────
export const mockPreset: PortfolioBuilderPreset = {
  id: "preset-uuid-1",
  userId: "user-uuid-1",
  name: "My Preset",
  riskLevel: "medium",
  investAmount: "1000.00",
  categories: ["Technology", "Healthcare"],
  stockCount: 5,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

// ─── Suggestions ──────────────────────────────────────────────────────────────
export const mockSuggestionItem = {
  ticker: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  category: "Technology",
  riskLevel: "low",
  marketCap: "large",
  description: "Makes iPhones.",
  price: 175.0,
  shares: 2.857,
  allocatedAmount: 499.98,
};

// ─── Auth session ─────────────────────────────────────────────────────────────
export const mockSession = {
  user: { email: "test@example.com", name: "Test User" },
};

// ─── DB chain helpers ─────────────────────────────────────────────────────────
export function mockDbSelect(finalValue: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(finalValue),
        orderBy: vi.fn().mockResolvedValue(finalValue),
      }),
      orderBy: vi.fn().mockResolvedValue(finalValue),
    }),
  };
}

export function mockDbInsert(returningValue: unknown) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returningValue),
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returningValue),
      }),
    }),
  };
}

export function mockDbUpdate(returningValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returningValue),
      }),
    }),
  };
}

export function mockDbDelete(returningValue: unknown = [{ id: "deleted" }]) {
  return {
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returningValue),
    }),
  };
}
```

---

## 9. Per-Utility Test Cases

### 9.1 `suggest-utils.test.ts`

File: `tests/lib/suggest-utils.test.ts`

**`buildAllocations`**

```ts
describe("buildAllocations", () => {
  it("divides total amount evenly and computes shares correctly")
  // amount=1000, 2 stocks at $100 each -> 5 shares each, allocatedAmount=500

  it("truncates shares to 4 decimal places")
  // price=3, perStock=10 -> shares = floor(3.3333... * 10000)/10000 = 3.3333

  it("skips stocks with price=0 from priceMap")
  // 3 stocks, one has price=0 -> only 2 in result

  it("skips stocks with price missing from priceMap")
  // 2 stocks, one ticker absent from priceMap -> 1 in result

  it("skips stocks where computed shares <= 0")
  // very high price relative to allocation -> 0 shares -> excluded

  it("allocatedAmount is price * shares rounded to 2 decimal places")
  // verify Math.round(shares * price * 100) / 100

  it("returns empty array if all stocks have zero/missing price")

  it("handles single stock")
  // full amount allocated to one stock
})
```

**`getPrices`** (requires `featureFlags.SUGGEST_FORCE_FRESH_PRICES = false`)

```ts
describe("getPrices", () => {
  it("returns fresh cached prices without hitting Finnhub")
  // db returns mockCachedQuote with recent updatedAt
  // fetchQuote NOT called

  it("fetches and caches prices for tickers missing from cache")
  // db returns empty, fetchQuote called, db.insert called with onConflictDoUpdate

  it("re-fetches stale tickers (age > 5 min)")
  // db returns stale quote, fetchQuote called for stale ticker

  it("does NOT re-fetch fresh tickers")

  it("skips caching if fetchQuote returns null")

  it("when SUGGEST_FORCE_FRESH_PRICES=true, always calls Finnhub")
  // set featureFlags.SUGGEST_FORCE_FRESH_PRICES = true in this test
})
```

### 9.2 `portfolio-utils.test.ts`

File: `tests/lib/portfolio-utils.test.ts`

```ts
describe("holdingCurrentValue", () => {
  it("returns shares * currentPrice")
  it("returns 0 when shares=0")
  it("handles fractional shares")
})

describe("holdingCostBasis", () => {
  it("returns shares * avgCostBasis")
})

describe("holdingGainLoss", () => {
  it("returns positive when currentPrice > avgCostBasis")
  it("returns negative when currentPrice < avgCostBasis")
  it("returns 0 when prices are equal")
})

describe("holdingGainLossPct", () => {
  it("returns correct percentage")
  it("returns 0 when costBasis is 0 (no division by zero)")
  it("returns negative percent for loss")
})

describe("portfolioTotalValue", () => {
  it("sums cash + all holding values")
  it("returns cashBalance when no holdings")
  it("handles multiple holdings correctly")
})

describe("portfolioPnL", () => {
  it("returns totalValue - startingBalance")
  it("returns negative when portfolio is down")
})

describe("portfolioPnLPct", () => {
  it("returns percent gain relative to starting balance")
  it("handles 0 starting balance without dividing by zero")
})
```

---

## 10. Per-Route Test Cases

### 10.1 `trade.test.ts` — `POST /api/trade`

```ts
// Auth
it("returns 401 when no session")

// Validation
it("returns 400 when ticker missing")
it("returns 400 when type missing")
it("returns 400 when shares missing")
it("returns 400 when portfolioId missing")
it("returns 400 when shares <= 0")

// Business logic — BUY
it("returns 404 when user not found in db")
it("returns 404 when portfolio not found or not owned by user")
it("returns 422 when no price data and Finnhub also returns null")
it("returns 422 when insufficient cash for BUY")
it("creates new holding when ticker not held, deducts cash, records transaction -> 200")
it("updates avgCostBasis weighted average when adding to existing holding")

// Business logic — SELL
it("returns 422 when user does not hold the stock")
it("returns 422 when selling more shares than held")
it("removes holding entirely when selling all shares (newShares < 0.0001)")
it("reduces holding shares, adds cash, records transaction -> 200")

// Cache miss -> live fetch
it("fetches live price from Finnhub when not in cache, then proceeds with trade")
```

### 10.2 `portfolio.test.ts` — `GET /api/portfolio`, `POST /api/portfolio`

```ts
// GET
it("returns 401 when no session")
it("returns 404 when user not in db")
it("returns portfolios array for authenticated user")
it("returns empty array when user has no portfolios")

// POST
it("returns 401 when no session")
it("returns 400 when name is missing")
it("returns 400 when name is empty string")
it("creates portfolio with startingBalance=5000.00, cashBalance=5000.00")
it("returns the created portfolio object")
```

### 10.3 `suggest.test.ts` — `GET /api/suggest`

```ts
it("returns 401 when no session")
it("returns 400 when portfolioId missing")
it("returns 400 when amount <= 0")
it("returns 400 when amount is NaN")
it("returns 400 when riskLevel invalid (e.g. 'extreme')")
it("returns 404 when user not found")
it("returns 404 when portfolio not owned by user")
it("returns 422 when amount > cashBalance")
it("returns 404 when no stocks found for riskLevel+categories combo")
it("returns suggestions array with price/shares/allocatedAmount")
it("respects count param (max 20)")
it("filters by categories when provided")
it("returns all risk-level stocks when categories not provided")
```

### 10.4 `suggest-execute.test.ts` — `POST /api/suggest/execute`

```ts
it("returns 401 when no session")
it("returns 400 when portfolioId missing")
it("returns 400 when allocations is not an array")
it("returns 400 when allocations is empty array")
it("returns 404 when user not found")
it("returns 404 when portfolio not owned")
it("executes all valid allocations, returns successCount + failCount + results")
it("marks allocation as failed when ticker/shares/price invalid")
it("marks allocation as failed when insufficient cash for that ticker")
it("succeeds partial: some allocations succeed, others fail (no rollback)")
it("updates existing holding with correct weighted avgCostBasis")
it("creates new holding when ticker not held")
it("records a transaction per successful allocation")
```

### 10.5 `suggest-swap.test.ts` — `POST /api/suggest/swap`

```ts
it("returns 401 when no session")
it("returns 400 when portfolioId missing")
it("returns 400 when tickerToReplace missing")
it("returns 404 when user not found")
it("returns 404 when portfolio not owned")
it("returns 404 when no replacement candidates available")
it("returns a replacement suggestion with ticker/name/price/shares/allocatedAmount")
it("excludes tickerToReplace and excludeTickers from candidates")
it("broadens search (drops category filter) when category-filtered candidates empty")
it("returns 422 when Finnhub returns no price for the replacement stock")
it("uses perStockAmount when provided instead of amount")
```

### 10.6 `presets.test.ts` — `GET /api/presets`, `POST /api/presets`

```ts
// GET
it("returns 401 when no session")
it("returns 404 when user not found")
it("returns presets array ordered by createdAt")
it("returns empty array when no presets")

// POST
it("returns 401 when no session")
it("returns 400 when name missing")
it("returns 400 when riskLevel invalid")
it("returns 400 when investAmount <= 0")
it("creates preset with correct fields and returns it")
it("defaults stockCount to 5 when not provided")
it("defaults categories to [] when not provided")
```

### 10.7 `presets-id.test.ts` — `PATCH /api/presets/[id]`, `DELETE /api/presets/[id]`

```ts
// PATCH
it("returns 401 when no session")
it("returns 400 when riskLevel invalid")
it("returns 404 when preset not found or not owned by user")
it("updates only provided fields (partial update)")
it("updates all fields when all provided")
it("returns updated preset")

// DELETE
it("returns 401 when no session")
it("returns 404 when preset not found or not owned")
it("deletes preset and returns { success: true }")
```

### 10.8 `watchlist.test.ts` — `POST /api/watchlist`, `DELETE /api/watchlist`

```ts
// POST
it("returns 401 when no session")
it("returns 400 when ticker missing")
it("returns 400 when portfolioId missing")
it("returns 404 when user not found")
it("returns 404 when portfolio not owned")
it("inserts and returns new watchlist item")
it("returns existing item with alreadyExists=true if already watching")

// DELETE
it("returns 401 when no session")
it("returns 400 when id param missing")
it("deletes watchlist item by id and returns { success: true }")
```

### 10.9 `watchlist-ticker.test.ts` — `GET/POST/DELETE /api/watchlist/[portfolioId]/[ticker]`

```ts
// GET
it("returns 401 when no session")
it("returns 404 when portfolio not owned")
it("returns { watching: false } when ticker not in watchlist")
it("returns { watching: true } when ticker is in watchlist")
it("normalizes ticker to uppercase")

// POST
it("returns 401 when no session")
it("returns 404 when portfolio not owned")
it("inserts watchlist entry, returns { watching: true }")
it("is idempotent — does not duplicate if already watching")

// DELETE
it("returns 401 when no session")
it("returns 404 when portfolio not owned")
it("removes watchlist entry, returns { watching: false }")
```

### 10.10 `stock-detail.test.ts` — `GET /api/stock-detail/[ticker]`

After refactor, this route has an auth guard.

```ts
it("returns 401 when no session")
it("returns 503 when all three Finnhub calls fail")
it("returns 404 when profile is null and no other data")
it("returns combined profile + fundamentals + quote")
it("falls back to cached quote when live quote fetch fails")
it("normalizes ticker to uppercase")
it("updates cachedQuotes.name when profile.name is available")
```

### 10.11 `candles.test.ts` — `GET /api/stock/candles/[ticker]`

After refactor, this route has an auth guard.

```ts
it("returns 401 when no session")
it("returns 400 when timeframe param missing")
it("returns 400 when timeframe param is invalid (e.g. '5D')")
it("returns 500 when FINNHUB_API_KEY not set")
it("returns 502 when upstream Finnhub returns non-ok response")
it("returns 502 when fetch throws (network error)")
it("returns candles array for valid timeframe '1D'")
it("returns candles for '1W', '1M', '3M', '1Y' timeframes")
it("returns { candles: [], noData: true } when Finnhub returns s='no_data'")
it("maps raw Finnhub candle arrays to CandlePoint objects with timestamp*1000")
```

### 10.12 `news.test.ts` — `GET /api/stock/news/[ticker]`

After refactor, this route has an auth guard.

```ts
it("returns 401 when no session")
it("returns 500 when FINNHUB_API_KEY not set")
it("returns { news: [] } when Finnhub returns non-ok")
it("returns { news: [] } when response is not array")
it("returns up to 10 news items, mapped to id/headline/source/url/image/datetime/summary")
it("normalizes ticker to uppercase in response")
```

### 10.13 `quotes.test.ts` — `GET /api/quotes`

After refactor, this route has an auth guard.

```ts
it("returns 401 when no session")
it("returns 400 when tickers param missing")
it("returns { quotes: {} } when tickers param is empty string")
it("returns fresh cached quotes without calling Finnhub")
it("marks quotes with age > 5min as stale=true")
it("synchronously fetches missing tickers and includes them in response")
it("fire-and-forget refreshes stale tickers (returns immediately with cached values)")
it("handles multiple tickers in comma-separated list")
```

### 10.14 `search.test.ts` — `GET /api/search`

After refactor, this route has an auth guard.

```ts
it("returns 401 when no session")
it("returns { results: [] } when q param missing")
it("returns { results: [] } when q is empty string")
it("calls searchSymbols with query and returns results")
it("returns { results: [] } when Finnhub throws")
it("fire-and-forget writes equity names to cachedQuotes")
it("returns up to 8 results (searchSymbols default limit)")
```

### 10.15 `cron-refresh-quotes.test.ts` — `GET /api/cron/refresh-quotes`

```ts
it("returns 401 when Authorization header missing")
it("returns 401 when Authorization header wrong")
it("returns 401 when CRON_SECRET not set")
it("returns { message: 'No tickers to refresh', refreshed: 0 } when no holdings/watchlist")
it("fetches quotes for all distinct holding + watchlist tickers")
it("upserts each quote into cachedQuotes")
it("includes failed count in response when some Finnhub calls fail")
it("reports correct refreshed count on full success")
```

### 10.16 `cron-snapshot.test.ts` — `GET /api/cron/snapshot`

```ts
it("returns 401 when Authorization header wrong")
it("records a snapshot for each portfolio")
it("totalValue = cashBalance + sum(shares * currentPrice) for each portfolio")
it("falls back to avgCostBasis when no cached quote for a holding ticker")
it("handles portfolios with no holdings (totalValue = cashBalance)")
it("returns { message, count } where count = number of portfolios snapshotted")
```

---

## 11. Per-Hook Test Cases

### 11.1 `useWatchlist.test.ts`

Setup: use `renderHook` from `@testing-library/react`. Stub `globalThis.fetch`.

```ts
describe("useWatchlist", () => {
  describe("initial fetch", () => {
    it("starts in 'loading' state")
    it("transitions to 'watching' when API returns { watching: true }")
    it("transitions to 'not_watching' when API returns { watching: false }")
    it("transitions to 'error' when fetch throws")
    it("transitions to 'error' when response is not ok")
    it("sets status to 'not_watching' immediately when portfolioId is null (no fetch)")
    it("cancels in-flight request on unmount (no state update after unmount)")
  })

  describe("re-fetch on dependency change", () => {
    it("re-fetches when ticker changes")
    it("re-fetches when portfolioId changes")
  })

  describe("toggle", () => {
    it("does nothing if status is 'loading'")
    it("does nothing if isToggling is true")
    it("does nothing if portfolioId is null")
    it("optimistically sets status to 'not_watching' when currently 'watching'")
    it("optimistically sets status to 'watching' when currently 'not_watching'")
    it("calls DELETE when status was 'watching'")
    it("calls POST when status was 'not_watching'")
    it("reverts status to 'watching' when DELETE fails")
    it("reverts status to 'not_watching' when POST fails")
    it("sets isToggling=true during request, false after")
  })
})
```

### 11.2 `useSwipeToDismiss.test.ts`

Setup: `renderHook`. Simulate touch events by calling returned handlers directly with synthetic touch event objects.

```ts
describe("useSwipeToDismiss", () => {
  it("initializes with dragY=0")

  it("sets dragY to delta when swiping down (positive delta)")
  // onTouchStart({ touches: [{ clientY: 100 }] })
  // onTouchMove({ touches: [{ clientY: 150 }] })
  // expect dragY === 50

  it("does not set negative dragY (upward swipe ignored)")
  // onTouchStart({ touches: [{ clientY: 150 }] })
  // onTouchMove({ touches: [{ clientY: 100 }] })
  // delta < 0 -> dragY stays 0

  it("does nothing on touchMove when touchStart not called first")
  // onTouchMove without prior onTouchStart -> dragY stays 0

  it("calls onClose when dragY >= 120px on touchEnd")
  // drag to 130px -> onTouchEnd -> onClose called

  it("springs back to 0 when dragY < 120px on touchEnd")
  // drag to 80px -> onTouchEnd -> dragY === 0, onClose NOT called

  it("calls onClose exactly at threshold (120px)")
  // drag to exactly 120px -> onClose called

  it("resets dragY to 0 and resets startYRef on touchEnd")
  // subsequent touchMove has no effect until new touchStart
})
```

---

## 12. Per-Component Test Cases

All component tests use `@testing-library/react`. Mock `next/navigation` where needed (`useRouter`, `usePathname`).

### 12.1 `TradePanel.test.tsx`

```ts
describe("TradePanel", () => {
  it("renders BUY tab selected by default")
  it("renders SELL tab and switches on click")
  it("shows stock price from quote prop")
  it("shows 'Loading price...' when quoteLoading=true")
  it("computes and displays total cost = quote.price * shares")
  it("shows '--' total cost when shares input empty")
  it("disables submit button when shares input is empty")
  it("disables submit button when quoteLoading=true")

  it("calls POST /api/trade with correct body on submit", async () => {
    // stub fetch to return { success: true }
    // fill shares input, click Buy
    // assert fetch called with ticker, type:'BUY', shares, portfolioId
  })

  it("shows error toast when trade API returns error message")
  it("shows success toast when trade succeeds")
  it("calls onSuccess callback after successful trade")
  it("re-enables submit button after failed trade")
  it("does not call API when shares <= 0")
})
```

### 12.2 `PositionBanner.test.tsx`

```ts
describe("PositionBanner", () => {
  it("renders total portfolio value = cashBalance + holdingsValue")
  it("renders positive P&L in green when above startingBalance")
  it("renders negative P&L in red when below startingBalance")
  it("renders 0 P&L correctly when value equals starting balance")
  it("renders P&L percentage")
  it("formats currency values with 2 decimal places")
})
```

### 12.3 `HoldingRow.test.tsx`

```ts
describe("HoldingRow", () => {
  it("renders ticker and shares")
  it("renders company name when provided")
  it("renders current value = shares * currentPrice")
  it("falls back to avgCostBasis for value when currentPrice not provided")
  it("shows positive gain/loss in green with + prefix")
  it("shows negative gain/loss in red")
  it("shows today's change percent when changePercent provided")
  it("opens StockDetailSheet on click")
  it("passes correct holding data to StockDetailSheet")
  it("shows integer share count without decimals for whole-share holdings")
  it("shows 4-decimal share count for fractional holdings")
})
```

### 12.4 `StockDetailSheet.test.tsx`

Mock `fetch` to return stock detail data. Mock `useWatchlist` and `useSwipeToDismiss`.

```ts
describe("StockDetailSheet", () => {
  it("renders nothing (closed) when open=false")
  it("fetches stock detail on open")
  it("displays company name from profile")
  it("displays current price from quote")
  it("displays price change and change percent")
  it("shows TrendingUp icon when change > 0")
  it("shows TrendingDown icon when change < 0")
  it("renders timeframe selector tabs (1D, 1W, 1M, 3M, 1Y)")
  it("switches chart timeframe on tab click")
  it("shows watch button when status is 'not_watching'")
  it("shows unwatch button when status is 'watching'")
  it("calls toggle() when watch button clicked")
  it("shows P&L for current holding when context='holdings'")
  it("shows swap button in builder context")
  it("calls onSwapIn(ticker) when swap confirmed")
  it("calls onClose when X button pressed")
  it("shows loading skeleton while fetching")
  it("shows error state when fetch fails")
  it("shows fundamentals (P/E, beta, 52W range) when available")
  it("shows news items when available")
  it("links news items to external URLs")
})
```

### 12.5 `PresetsPanel.test.tsx`

```ts
describe("PresetsPanel", () => {
  it("renders 'No presets saved' when presets array is empty")
  it("renders preset cards with name, riskLevel, investAmount, stockCount")
  it("calls onSelectPreset with preset data when card clicked")
  it("shows delete button on each preset card")
  it("calls DELETE /api/presets/[id] when delete clicked, removes from list")
  it("renders save-as-preset button and opens save dialog")
  it("submits POST /api/presets with current wizard config on save")
  it("adds saved preset to list without page reload")
  it("shows error toast when save fails")
})
```

### 12.6 `Step1Config.test.tsx`

```ts
describe("Step1Config (Portfolio Builder)", () => {
  it("renders invest amount input")
  it("renders risk level selector (low/medium/high)")
  it("renders category multi-select")
  it("renders stock count selector")
  it("calls onConfigChange with updated values on change")
  it("proceeds to Step 2 when 'Get Suggestions' clicked with valid config")
  it("disables submit when investAmount is 0")
  it("shows available cash balance")
  it("disables submit when investAmount > cashBalance")
})
```

### 12.7 `Step2Suggestions.test.tsx`

```ts
describe("Step2Suggestions", () => {
  it("shows loading state while fetching suggestions")
  it("renders suggestion cards with ticker, name, shares, allocatedAmount")
  it("renders swap button on each suggestion card")
  it("fetches replacement from /api/suggest/swap on swap click")
  it("replaces the swapped card with new suggestion")
  it("shows loading on individual card during swap")
  it("shows error toast when swap fails")
  it("opens StockDetailSheet when suggestion card tapped")
  it("proceeds to Step 3 on 'Confirm' click with current suggestions")
  it("goes back to Step 1 on 'Back' click")
  it("shows 'No suggestions found' state when suggestions array empty")
})
```

### 12.8 `Step3Confirm.test.tsx`

```ts
describe("Step3Confirm", () => {
  it("renders summary of all allocations with ticker/shares/cost")
  it("renders total invested amount")
  it("renders remaining cash after execution")
  it("calls POST /api/suggest/execute on 'Execute All' click")
  it("shows per-trade success/failure results after execution")
  it("shows overall successCount and failCount")
  it("disables 'Execute All' button during execution")
  it("goes back to Step 2 on 'Back' click")
  it("shows completion state after all trades finish")
})
```

---

## 13. Auth Gate Test Pattern

A reusable `test.each` over all protected routes.

```ts
// tests/api/auth-gate.test.ts
import { testApiHandler } from "next-test-api-route-handler";
import { auth } from "@/auth";
import { vi } from "vitest";

import * as tradeHandler from "@/app/api/trade/route";
import * as portfolioHandler from "@/app/api/portfolio/route";
import * as suggestHandler from "@/app/api/suggest/route";
import * as suggestExecuteHandler from "@/app/api/suggest/execute/route";
import * as suggestSwapHandler from "@/app/api/suggest/swap/route";
import * as presetsHandler from "@/app/api/presets/route";
import * as presetsIdHandler from "@/app/api/presets/[id]/route";
import * as watchlistHandler from "@/app/api/watchlist/route";
import * as watchlistTickerHandler from "@/app/api/watchlist/[portfolioId]/[ticker]/route";
import * as stockDetailHandler from "@/app/api/stock-detail/[ticker]/route";
import * as candlesHandler from "@/app/api/stock/candles/[ticker]/route";
import * as newsHandler from "@/app/api/stock/news/[ticker]/route";
import * as quotesHandler from "@/app/api/quotes/route";
import * as searchHandler from "@/app/api/search/route";

type AuthGateCase = {
  name: string;
  handler: object;
  method: "GET" | "POST" | "DELETE" | "PATCH";
  params?: Record<string, string>;
  body?: object;
};

const PROTECTED_ROUTES: AuthGateCase[] = [
  { name: "POST /api/trade", handler: tradeHandler, method: "POST", body: {} },
  { name: "GET /api/portfolio", handler: portfolioHandler, method: "GET" },
  { name: "POST /api/portfolio", handler: portfolioHandler, method: "POST", body: {} },
  { name: "GET /api/suggest", handler: suggestHandler, method: "GET" },
  { name: "POST /api/suggest/execute", handler: suggestExecuteHandler, method: "POST", body: {} },
  { name: "POST /api/suggest/swap", handler: suggestSwapHandler, method: "POST", body: {} },
  { name: "GET /api/presets", handler: presetsHandler, method: "GET" },
  { name: "POST /api/presets", handler: presetsHandler, method: "POST", body: {} },
  { name: "PATCH /api/presets/[id]", handler: presetsIdHandler, method: "PATCH", params: { id: "x" }, body: {} },
  { name: "DELETE /api/presets/[id]", handler: presetsIdHandler, method: "DELETE", params: { id: "x" } },
  { name: "POST /api/watchlist", handler: watchlistHandler, method: "POST", body: {} },
  { name: "DELETE /api/watchlist", handler: watchlistHandler, method: "DELETE" },
  { name: "GET /api/watchlist/[pId]/[ticker]", handler: watchlistTickerHandler, method: "GET", params: { portfolioId: "p1", ticker: "AAPL" } },
  { name: "POST /api/watchlist/[pId]/[ticker]", handler: watchlistTickerHandler, method: "POST", params: { portfolioId: "p1", ticker: "AAPL" } },
  { name: "DELETE /api/watchlist/[pId]/[ticker]", handler: watchlistTickerHandler, method: "DELETE", params: { portfolioId: "p1", ticker: "AAPL" } },
  { name: "GET /api/stock-detail/[ticker]", handler: stockDetailHandler, method: "GET", params: { ticker: "AAPL" } },
  { name: "GET /api/stock/candles/[ticker]", handler: candlesHandler, method: "GET", params: { ticker: "AAPL" } },
  { name: "GET /api/stock/news/[ticker]", handler: newsHandler, method: "GET", params: { ticker: "AAPL" } },
  { name: "GET /api/quotes", handler: quotesHandler, method: "GET" },
  { name: "GET /api/search", handler: searchHandler, method: "GET" },
];

describe("Auth gates — all protected routes return 401 with no session", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(null);
  });

  test.each(PROTECTED_ROUTES)("$name -> 401", async ({ handler, method, params, body }) => {
    await testApiHandler({
      appHandler: handler as Parameters<typeof testApiHandler>[0]["appHandler"],
      params,
      test: async ({ fetch }) => {
        const res = await fetch({
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.error).toBe("Unauthorized");
      },
    });
  });
});
```

---

## 14. GitHub Actions Workflow

Create at `.github/workflows/test.yml`:

```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  test:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest

    env:
      # Mocked in tests, but referenced at module import time by some handlers
      FINNHUB_API_KEY: "ci-mock-key"
      CRON_SECRET: "ci-mock-secret"
      NEXTAUTH_SECRET: "ci-mock-secret"
      NEXTAUTH_URL: "http://localhost:3000"
      DATABASE_URL: "postgresql://ci:ci@localhost/ci"  # never actually connected

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run tests with coverage
        run: npm run test:coverage

      - name: Upload coverage artifact (optional)
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/
          retention-days: 7
```

**Notes:**
- No database service container needed — all DB calls are mocked
- `FINNHUB_API_KEY` must be set so the `if (!apiKey)` guards in route handlers don't short-circuit before auth is checked
- Coverage printed to console only; no Codecov or third-party service needed

---

## 15. Coverage Configuration

v8 coverage is declared in `vitest.config.ts` (Section 4). Reporters `"text"` + `"text-summary"` emit to console only.

Run locally:
```bash
npm run test:coverage
```

Sample output:
```
 % Coverage report from v8
 File                          | % Stmts | % Branch | % Funcs | % Lines
 ------------------------------|---------|----------|---------|--------
 src/lib/suggest-utils.ts      |   98.2  |   95.0   |  100.0  |   98.2
 src/lib/portfolio-utils.ts    |  100.0  |  100.0   |  100.0  |  100.0
 src/app/api/trade/route.ts    |   88.4  |   82.3   |  100.0  |   88.4
```

Current thresholds (fail CI if below):

| Metric | Threshold |
|---|---|
| Lines | 75% |
| Functions | 75% |
| Branches | 65% |

Raise thresholds incrementally as coverage improves.

---

## 16. Open Dev Decisions

1. **DB mock granularity:** The fluent Drizzle chain mock in `setup.ts` is intentionally coarse (returns `this` for chainable methods). Individual tests must override specific terminal methods (`.limit()`, `.returning()`, etc.) per scenario. If this becomes unwieldy, consider a `createMockDb()` factory that returns a fresh typed mock per test rather than a shared singleton.

2. **`db.transaction()` mock pattern:** Drizzle transactions pass a `tx` callback. Mock pattern:
   ```ts
   vi.mocked(db.transaction).mockImplementation(async (fn) => fn(db as any));
   ```
   This lets the callback reuse the same mocked `db` methods. Tests verifying rollback behavior should mock the callback to throw and assert the error response.

3. **MSW vs `vi.stubGlobal("fetch")`:** This spec uses `vi.stubGlobal("fetch", vi.fn())` per test for simplicity. If component tests grow complex (multiple concurrent fetches, error recovery), adopt MSW. Add `tests/mocks/handlers.ts` and `tests/mocks/server.ts` following the MSW v2 Node.js setup.

4. **`featureFlags` override in tests:** `featureFlags` is mocked globally to `{ SUGGEST_FORCE_FRESH_PRICES: false }`. For tests requiring `true`, mutate inline:
   ```ts
   import { featureFlags } from "@/lib/featureFlags";
   (featureFlags as any).SUGGEST_FORCE_FRESH_PRICES = true;
   ```
   Reset in `afterEach`. The global mock prevents real imports.

5. **`useActivePortfolio` context wrapper:** Components consuming `useActivePortfolio` need the context provider in tests:
   ```tsx
   const wrapper = ({ children }: { children: React.ReactNode }) => (
     <ActivePortfolioContext.Provider value={{ activePortfolioId: "p1", setActivePortfolioId: vi.fn() }}>
       {children}
     </ActivePortfolioContext.Provider>
   );
   render(<HoldingRow {...props} />, { wrapper });
   ```

6. **`StockDetailSheet` complexity:** This component bundles chart data fetching, timeframe selection, watchlist integration, swipe-to-dismiss, and trade/swap UI into one component. Tests will need heavy mocking. Consider extracting `StockDetailContent` (pure render, no fetch) as a testable inner component and wrapping it in `StockDetailSheet` for the real app. The spec tests `StockDetailSheet` as a black box for now.

7. **`selectDistinct` mock:** The global DB mock does not currently chain `.from()` after `selectDistinct`. Add to `setup.ts`:
   ```ts
   selectDistinct: vi.fn().mockReturnValue({
     from: vi.fn().mockResolvedValue([]),
   }),
   ```
   Override per test in cron route tests.

8. **`ntarh` import paths:** Dynamic route files like `src/app/api/presets/[id]/route.ts` import correctly via TypeScript path alias `@/app/api/presets/[id]/route`. Bracket chars in paths work fine in imports — they're just directory names.

9. **CI secret management:** `FINNHUB_API_KEY` and `CRON_SECRET` in the workflow file are fake values. If the project ever adds tests that make real network calls (e.g., a separate e2e workflow), use GitHub Secrets. For this test suite, hardcoded CI values are intentional and safe.

10. **PortfolioBuilderWizard integration test:** An end-to-end wizard flow (Step1 -> Step2 -> Step3 -> execute) is high value but deferred. Once per-step unit tests are stable, add `tests/components/builder/PortfolioBuilderWizard.integration.test.tsx` using MSW to mock all API endpoints and simulate the full flow.

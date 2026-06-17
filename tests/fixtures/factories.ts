import { vi } from "vitest";
import type {
  User,
  Portfolio,
  Holding,
  WatchlistItem,
  PortfolioBuilderPreset,
  StockUniverse,
  CachedQuote,
  Transaction,
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

// ─── Transactions ─────────────────────────────────────────────────────────────
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
  updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10min ago = stale
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

// Watchlist item
export const mockWatchlistItem: WatchlistItem = {
  id: "watchlist-uuid-1",
  portfolioId: "portfolio-uuid-1",
  ticker: "AAPL",
  addedAt: new Date("2025-03-01"),
};

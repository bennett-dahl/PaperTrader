import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
const mockWhere = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockWhere }) }),
    insert: () => ({ values: mockValues }),
  },
}));

vi.mock("@/db/schema", () => ({
  cachedQuotes: {},
}));

// Mock drizzle operators
vi.mock("drizzle-orm", () => ({
  inArray: vi.fn(),
}));

// Mock Finnhub
const mockFetchQuote = vi.fn();
vi.mock("@/lib/finnhub", () => ({
  getFinnhubClient: vi.fn(() => ({})),
  fetchQuote: (...args: unknown[]) => mockFetchQuote(...args),
}));

import { refreshStaleQuotes } from "@/lib/refresh-quotes";

const FRESH_UPDATED_AT = new Date(Date.now() - 60_000).toISOString(); // 1 min ago → fresh
const STALE_UPDATED_AT = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago → stale

beforeEach(() => {
  vi.clearAllMocks();
  mockOnConflictDoUpdate.mockResolvedValue(undefined);
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
});

describe("refreshStaleQuotes", () => {
  it("returns empty map for empty ticker list", async () => {
    const result = await refreshStaleQuotes([]);
    expect(result).toEqual({});
    expect(mockFetchQuote).not.toHaveBeenCalled();
  });

  it("returns cached prices when all quotes are fresh", async () => {
    mockWhere.mockResolvedValue([
      { ticker: "AAPL", price: "180.00", change: "1.50", changePercent: "0.84", updatedAt: FRESH_UPDATED_AT },
      { ticker: "MSFT", price: "420.00", change: "-0.50", changePercent: "-0.12", updatedAt: FRESH_UPDATED_AT },
    ]);

    const result = await refreshStaleQuotes(["AAPL", "MSFT"]);

    expect(result).toEqual({
      AAPL: { price: 180, change: 1.5, changePercent: 0.84 },
      MSFT: { price: 420, change: -0.5, changePercent: -0.12 },
    });
    expect(mockFetchQuote).not.toHaveBeenCalled();
  });

  it("fetches from Finnhub for stale quotes and updates cache", async () => {
    mockWhere.mockResolvedValue([
      { ticker: "AMD", price: "475.50", change: "5.00", changePercent: "1.06", updatedAt: STALE_UPDATED_AT },
    ]);
    mockFetchQuote.mockResolvedValue({ c: 547.26, d: 71.76, dp: 15.09 });

    const result = await refreshStaleQuotes(["AMD"]);

    expect(mockFetchQuote).toHaveBeenCalledWith({}, "AMD");
    expect(mockValues).toHaveBeenCalledWith({
      ticker: "AMD",
      price: "547.26",
      change: "71.76",
      changePercent: "15.09",
    });
    expect(result.AMD).toEqual({ price: 547.26, change: 71.76, changePercent: 15.09 });
  });

  it("fetches from Finnhub for missing tickers (not in cache)", async () => {
    mockWhere.mockResolvedValue([]); // nothing cached
    mockFetchQuote.mockResolvedValue({ c: 190.00, d: 2.00, dp: 1.06 });

    const result = await refreshStaleQuotes(["NVDA"]);

    expect(mockFetchQuote).toHaveBeenCalledWith({}, "NVDA");
    expect(result.NVDA).toEqual({ price: 190, change: 2, changePercent: 1.06 });
  });

  it("falls back gracefully when Finnhub returns null", async () => {
    mockWhere.mockResolvedValue([
      { ticker: "XOM", price: "110.00", change: "0.50", changePercent: "0.45", updatedAt: STALE_UPDATED_AT },
    ]);
    mockFetchQuote.mockResolvedValue(null);

    const result = await refreshStaleQuotes(["XOM"]);

    // Should keep the stale cached value since fetch returned null
    expect(result.XOM).toEqual({ price: 110, change: 0.5, changePercent: 0.45 });
  });

  it("handles partial Finnhub failures and still returns successful quotes", async () => {
    mockWhere.mockResolvedValue([
      { ticker: "AAPL", price: "180.00", change: "1.00", changePercent: "0.56", updatedAt: STALE_UPDATED_AT },
      { ticker: "MSFT", price: "400.00", change: "-1.00", changePercent: "-0.25", updatedAt: STALE_UPDATED_AT },
    ]);
    mockFetchQuote
      .mockResolvedValueOnce({ c: 185.00, d: 1.50, dp: 0.82 }) // AAPL ok
      .mockRejectedValueOnce(new Error("rate limited"));          // MSFT fails

    const result = await refreshStaleQuotes(["AAPL", "MSFT"]);

    expect(result.AAPL).toEqual({ price: 185, change: 1.5, changePercent: 0.82 });
    // MSFT keeps stale value since fetch failed
    expect(result.MSFT).toEqual({ price: 400, change: -1, changePercent: -0.25 });
  });

  it("deduplicates tickers to avoid redundant Finnhub calls", async () => {
    mockWhere.mockResolvedValue([]); // nothing cached
    mockFetchQuote.mockResolvedValue({ c: 200.00, d: 0, dp: 0 });

    await refreshStaleQuotes(["AAPL", "AAPL"]);

    // Should only call once despite duplicate input
    expect(mockFetchQuote).toHaveBeenCalledTimes(1);
  });
});

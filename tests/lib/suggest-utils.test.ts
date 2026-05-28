import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { fetchQuote } from "@/lib/finnhub";
import { featureFlags } from "@/lib/featureFlags";

// We import these after mocks are set up
import { buildAllocations, getPrices } from "@/lib/suggest-utils";

const mockStock = {
  ticker: "AAPL",
  name: "Apple Inc.",
  sector: "Technology",
  category: "Technology",
  riskLevel: "low",
  marketCap: "large",
  description: "Makes iPhones.",
};

const mockStock2 = {
  ticker: "MSFT",
  name: "Microsoft Corp.",
  sector: "Technology",
  category: "Technology",
  riskLevel: "low",
  marketCap: "large",
  description: "Makes Windows.",
};

describe("buildAllocations", () => {
  beforeEach(() => {
    // Default: cached prices for both stocks
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "100.00", updatedAt: new Date() },
          { ticker: "MSFT", price: "100.00", updatedAt: new Date() },
        ]),
      }),
    } as any);
  });

  it("divides total amount evenly and computes shares correctly", async () => {
    // 2 stocks at $100 each, total = $1000 -> $500 per stock -> 5 shares each
    const result = await buildAllocations(
      ["AAPL", "MSFT"],
      [mockStock, mockStock2],
      1000
    );
    expect(result).toHaveLength(2);
    expect(result[0].shares).toBe(5);
    expect(result[0].allocatedAmount).toBe(500);
  });

  it("truncates shares to 4 decimal places", async () => {
    // price=3, perStock = 10/1 = 10 -> shares = floor(10/3 * 10000)/10000 = 3.3333
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "3.00", updatedAt: new Date() },
        ]),
      }),
    } as any);
    const result = await buildAllocations(["AAPL"], [mockStock], 10);
    expect(result[0].shares).toBe(3.3333);
  });

  it("skips stocks with price=0 from priceMap", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "100.00", updatedAt: new Date() },
          { ticker: "MSFT", price: "0", updatedAt: new Date() },
        ]),
      }),
    } as any);
    const result = await buildAllocations(
      ["AAPL", "MSFT"],
      [mockStock, mockStock2],
      1000
    );
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe("AAPL");
  });

  it("skips stocks with price missing from priceMap", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "100.00", updatedAt: new Date() },
          // MSFT is absent from cache
        ]),
      }),
    } as any);
    // fetchQuote returns null for MSFT (missing ticker)
    vi.mocked(fetchQuote).mockResolvedValue(null);
    
    const result = await buildAllocations(
      ["AAPL", "MSFT"],
      [mockStock, mockStock2],
      1000
    );
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe("AAPL");
  });

  it("skips stocks where computed shares <= 0", async () => {
    // Very high price ($10000001) relative to allocation ($1000)
    // shares = floor(1000/10000001 * 10000)/10000 = floor(0.0009999...) / 10000 = 0
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "10000001.00", updatedAt: new Date() },
        ]),
      }),
    } as any);
    const result = await buildAllocations(["AAPL"], [mockStock], 1000);
    expect(result).toHaveLength(0);
  });

  it("allocatedAmount is price * shares rounded to 2 decimal places", async () => {
    // price=3, shares=3.3333 -> allocatedAmount = round(3.3333 * 3 * 100)/100 = 9.9999 -> 10.00
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "3.00", updatedAt: new Date() },
        ]),
      }),
    } as any);
    const result = await buildAllocations(["AAPL"], [mockStock], 10);
    expect(result[0].allocatedAmount).toBe(Math.round(result[0].shares * 3 * 100) / 100);
  });

  it("returns empty array if all stocks have zero/missing price", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);
    vi.mocked(fetchQuote).mockResolvedValue(null);
    const result = await buildAllocations(
      ["AAPL", "MSFT"],
      [mockStock, mockStock2],
      1000
    );
    expect(result).toHaveLength(0);
  });

  it("handles single stock", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "100.00", updatedAt: new Date() },
        ]),
      }),
    } as any);
    const result = await buildAllocations(["AAPL"], [mockStock], 1000);
    expect(result).toHaveLength(1);
    expect(result[0].shares).toBe(10);
    expect(result[0].allocatedAmount).toBe(1000);
  });
});

describe("getPrices", () => {
  it("returns fresh cached prices without hitting Finnhub", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "175.00", updatedAt: new Date() }, // fresh
        ]),
      }),
    } as any);

    const prices = await getPrices(["AAPL"]);
    expect(prices["AAPL"]).toBe(175);
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("fetches and caches prices for tickers missing from cache", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]), // empty cache
      }),
    } as any);
    vi.mocked(fetchQuote).mockResolvedValue({ c: 200, d: 1, dp: 0.5 });
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    const prices = await getPrices(["AAPL"]);
    expect(prices["AAPL"]).toBe(200);
    expect(fetchQuote).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it("re-fetches stale tickers (age > 5 min)", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            ticker: "AAPL",
            price: "170.00",
            updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10min old = stale
          },
        ]),
      }),
    } as any);
    vi.mocked(fetchQuote).mockResolvedValue({ c: 175, d: 1, dp: 0.5 });
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    await getPrices(["AAPL"]);
    expect(fetchQuote).toHaveBeenCalled();
  });

  it("does NOT re-fetch fresh tickers", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { ticker: "AAPL", price: "175.00", updatedAt: new Date() }, // fresh
        ]),
      }),
    } as any);

    await getPrices(["AAPL"]);
    expect(fetchQuote).not.toHaveBeenCalled();
  });

  it("skips caching if fetchQuote returns null", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);
    vi.mocked(fetchQuote).mockResolvedValue(null);

    const prices = await getPrices(["AAPL"]);
    expect(prices["AAPL"]).toBeUndefined();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("when SUGGEST_FORCE_FRESH_PRICES=true, always calls Finnhub", async () => {
    // Override the feature flag mock for this test
    (featureFlags as any).SUGGEST_FORCE_FRESH_PRICES = true;
    vi.mocked(fetchQuote).mockResolvedValue({ c: 180, d: 2, dp: 1 });
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    await getPrices(["AAPL"]);
    expect(fetchQuote).toHaveBeenCalled();
    // Restore
    (featureFlags as any).SUGGEST_FORCE_FRESH_PRICES = false;
  });
});

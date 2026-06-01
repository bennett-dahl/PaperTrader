import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockSession, mockStockUniverse } from "../fixtures/factories";

import * as handler from "@/app/api/suggest/swap/route";

describe("POST /api/suggest/swap", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when portfolioId missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickerToReplace: "AAPL" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when tickerToReplace missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1", tickerToReplace: "AAPL", riskLevel: "low", categories: [], excludeTickers: [] }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when no replacement candidates available", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [mockPortfolio];
          }),
          mockResolvedValue: [],
        }),
      }),
    } as any));

    // Swap needs to return empty from stock universe
    vi.mocked(db.select)
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }) }) } as any)
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }) }) } as any)
      .mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "AAPL",
            riskLevel: "low",
            categories: [],
            excludeTickers: [],
          }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return []; // portfolio not found
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1", tickerToReplace: "AAPL", riskLevel: "low", categories: [], excludeTickers: [] }),
        });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/portfolio not found/i);
      },
    });
  });

  it("returns 422 when price cannot be fetched for replacement stock", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue(null);

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
          }),
        } as any;
      }
      if (callCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }),
          }),
        } as any;
      }
      if (callCount === 3) {
        // stock universe query - returns one candidate
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockStockUniverse]),
          }),
        } as any;
      }
      // cachedQuotes query - no cached price
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "TSLA",
            riskLevel: "low",
            categories: ["Technology"],
            excludeTickers: ["TSLA"],
            amount: 500,
          }),
        });
        expect(res.status).toBe(422);
      },
    });
  });

  it("returns 200 with suggestion when cached price is fresh", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const freshCachedQuote = { ticker: "AAPL", price: "175.00", change: "1.00", changePercent: "0.57", updatedAt: new Date() };

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
          }),
        } as any;
      }
      if (callCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }),
          }),
        } as any;
      }
      if (callCount === 3) {
        // stock universe - returns candidate
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockStockUniverse]),
          }),
        } as any;
      }
      // cachedQuotes query - fresh price
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([freshCachedQuote]),
          }),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "TSLA",
            riskLevel: "low",
            categories: [],
            excludeTickers: ["TSLA"],
            amount: 500,
            perStockAmount: 500,
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.suggestion).toBeDefined();
        expect(json.suggestion.ticker).toBe("AAPL");
        expect(json.suggestion.price).toBe(175.0);
      },
    });
  });

  it("broadens search to drop category filter when no candidates found with filter", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const freshCachedQuote = { ticker: "AAPL", price: "175.00", change: "1.00", changePercent: "0.57", updatedAt: new Date() };

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
          }),
        } as any;
      }
      if (callCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }),
          }),
        } as any;
      }
      if (callCount === 3) {
        // First stock universe query with category filter - empty
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        } as any;
      }
      if (callCount === 4) {
        // Second stock universe query without category filter - returns candidate
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockStockUniverse]),
          }),
        } as any;
      }
      // cachedQuotes query - fresh price
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([freshCachedQuote]),
          }),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "TSLA",
            riskLevel: "low",
            categories: ["SomeRareCategory"],
            excludeTickers: [],
            amount: 500,
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.suggestion).toBeDefined();
      },
    });
  });
});

  it("fetches from Finnhub and caches when price is stale", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue({ c: 175.0, d: 1.5, dp: 0.86 });

    const staleQuote = { ticker: "AAPL", price: "170.00", change: "1.00", changePercent: "0.59", updatedAt: new Date(Date.now() - 10 * 60 * 1000) };

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }) }) } as any;
      if (callCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }) }) } as any;
      if (callCount === 3) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockStockUniverse]) }) } as any;
      // stale cached quote
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([staleQuote]) }) }) } as any;
    });

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "TSLA",
            riskLevel: "low",
            categories: [],
            excludeTickers: ["TSLA"],
            amount: 500,
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.suggestion.price).toBe(175.0);
      },
    });
  });

  it("returns null price (422) when Finnhub throws exception", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const { fetchQuote, getFinnhubClient } = await import("@/lib/finnhub");
    vi.mocked(getFinnhubClient).mockImplementation(() => { throw new Error("Client error"); });

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }) }) } as any;
      if (callCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }) }) } as any;
      if (callCount === 3) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([mockStockUniverse]) }) } as any;
      return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) } as any;
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "TSLA",
            riskLevel: "low",
            categories: [],
            excludeTickers: [],
          }),
        });
        expect(res.status).toBe(422);
      },
    });

    vi.mocked(getFinnhubClient).mockReturnValue({});
  });

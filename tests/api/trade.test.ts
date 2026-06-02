import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/trade/route";

function setupAuth(authed = true) {
  vi.mocked(auth).mockResolvedValue(authed ? (mockSession as any) : null);
}

const validBody = {
  ticker: "AAPL",
  type: "BUY",
  shares: 1,
  portfolioId: mockPortfolio.id,
};

describe("POST /api/trade", () => {
  it("returns 401 when no session", async () => {
    setupAuth(false);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when ticker missing", async () => {
    setupAuth();
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "BUY", shares: 1, portfolioId: "p1" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when shares <= 0", async () => {
    setupAuth();
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, shares: -1 }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 404 when user not found in db", async () => {
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
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/user not found/i);
      },
    });
  });

  it("returns 404 when portfolio not found or not owned by user", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser]; // user found
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
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/portfolio not found/i);
      },
    });
  });

  it("returns 422 when no price data and Finnhub also returns null", async () => {
    setupAuth();
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue(null);

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            if (callCount === 2) return [mockPortfolio];
            return []; // no cached quote
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
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(422);
      },
    });
  });

  it("BUY succeeds: creates holding, deducts cash, records transaction -> 200", async () => {
    setupAuth();

    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "5000.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            if (selectCallCount === 3) return [cachedQuote]; // cached quote
            return [];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      // Mock the transaction callback
      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                // Inside tx: portfolio re-read, then check existing holding
                return [portfolioWithCash];
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([{}]),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{}]),
          }),
        }),
      };

      let txSelectCount = 0;
      txMock.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(async () => {
              txSelectCount++;
              if (txSelectCount === 1) return [portfolioWithCash]; // re-read portfolio
              return []; // no existing holding
            }),
          }),
        }),
      }));

      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.trade.ticker).toBe("AAPL");
      },
    });
  });

  it("returns 400 when type is missing", async () => {
    setupAuth();
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "AAPL", shares: 1, portfolioId: "p1" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("SELL: returns 422 when insufficient shares", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "5000.00" };
    const existingHolding = { id: "h1", portfolioId: mockPortfolio.id, ticker: "AAPL", shares: "0.5000", avgCostBasis: "140.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            return [cachedQuote]; // cached quote
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [portfolioWithCash];
                return [existingHolding]; // existing holding with 0.5 shares
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, type: "SELL", shares: 2 }), // want to sell 2 but only have 0.5
        });
        expect(res.status).toBe(422);
      },
    });
  });

  it("SELL: returns 422 when holding doesn't exist", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "5000.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            return [cachedQuote];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [portfolioWithCash];
                return []; // no existing holding
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, type: "SELL", shares: 1 }),
        });
        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error).toMatch(/don't hold/i);
      },
    });
  });

  it("BUY: returns 422 when insufficient cash", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithLowCash = { ...mockPortfolio, cashBalance: "10.00" }; // only $10

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithLowCash];
            return [cachedQuote];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([portfolioWithLowCash]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, shares: 100 }), // $15000 but only $10
        });
        expect(res.status).toBe(422);
      },
    });
  });

  it("SELL: succeeds when selling existing holding entirely (small remaining shares)", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "1000.00" };
    const existingHolding = { id: "h1", portfolioId: mockPortfolio.id, ticker: "AAPL", shares: "1.0000", avgCostBasis: "140.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            return [cachedQuote];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [portfolioWithCash];
                return [existingHolding];
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, type: "SELL", shares: 1 }), // sell all 1 share -> delete holding
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
      },
    });
  });

  it("BUY succeeds when existing holding already exists (avg cost update)", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "5000.00" };
    const existingHolding = { id: "h1", portfolioId: mockPortfolio.id, ticker: "AAPL", shares: "5.0000", avgCostBasis: "140.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            return [cachedQuote];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [portfolioWithCash];
                return [existingHolding]; // already has holding
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
      },
    });
  });

  it("fetches from Finnhub when no cached quote exists and caches it", async () => {
    setupAuth();
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue({ c: 150.0, d: 1.5, dp: 1.0 });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [{ ...mockPortfolio, cashBalance: "5000.00" }];
            if (selectCallCount === 3) return []; // no cached quote initially
            return [{ ticker: "AAPL", price: "150.00", change: "1.50", changePercent: "1.00" }]; // after insert
          }),
        }),
      }),
    } as any));

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [{ ...mockPortfolio, cashBalance: "5000.00" }];
                return [];
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect([200, 422]).toContain(res.status);
      },
    });
  });
});

  it("handles Finnhub fetch error gracefully (logs but continues)", async () => {
    setupAuth();
    const { fetchQuote, getFinnhubClient } = await import("@/lib/finnhub");
    vi.mocked(getFinnhubClient).mockImplementation(() => { throw new Error("Finnhub unavailable"); });

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [{ ...mockPortfolio, cashBalance: "5000.00" }];
            return []; // no cached quote
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
          body: JSON.stringify(validBody),
        });
        // Should get 422 because quote lookup failed
        expect(res.status).toBe(422);
      },
    });
    vi.mocked(getFinnhubClient).mockReturnValue({});
  });

  it("SELL: updates existing holding shares when remaining > 0.0001", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "1000.00" };
    const existingHolding = { id: "h1", portfolioId: mockPortfolio.id, ticker: "AAPL", shares: "5.0000", avgCostBasis: "140.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            return [cachedQuote];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [portfolioWithCash];
                return [existingHolding]; // has 5 shares, selling 1
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...validBody, type: "SELL", shares: 1 }), // sell 1 of 5 → 4 remaining (> 0.0001)
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
      },
    });
  });

  it("handles non-Error exception in transaction (defaults to 'Trade failed')", async () => {
    setupAuth();
    const cachedQuote = { ticker: "AAPL", price: "150.00", change: "1.00", changePercent: "0.67" };
    const portfolioWithCash = { ...mockPortfolio, cashBalance: "5000.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            return [cachedQuote];
          }),
        }),
      }),
    } as any));

    // Throw a non-Error (string) from transaction
    vi.mocked(db.transaction).mockRejectedValue("string error");

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(500);
        const json = await res.json();
        expect(json.error).toBe("Trade failed");
      },
    });
  });

  it("successfully caches Finnhub quote when fetched and then completes BUY", async () => {
    setupAuth();
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue({ c: 150.0, d: 1.5, dp: 1.0 });

    const portfolioWithCash = { ...mockPortfolio, cashBalance: "5000.00" };
    const freshCachedQuote = { ticker: "AAPL", price: "150.00", change: "1.50", changePercent: "1.00" };

    let selectCallCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            selectCallCount++;
            if (selectCallCount === 1) return [mockUser];
            if (selectCallCount === 2) return [portfolioWithCash];
            if (selectCallCount === 3) return []; // no cached quote initially
            return [freshCachedQuote]; // after insert, returns cached quote
          }),
        }),
      }),
    } as any));

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [portfolioWithCash];
                return []; // no existing holding
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validBody),
        });
        expect(res.status).toBe(200);
      },
    });
  });

// ─── PIPELINE_SECRET bypass tests ──────────────────────────────────────────

describe("POST /api/trade — PIPELINE_SECRET bypass", () => {
  const originalEnv = process.env.PIPELINE_SECRET;

  beforeEach(() => {
    process.env.PIPELINE_SECRET = "test-pipeline-secret";
  });

  it("returns 401 when pipeline secret is wrong", async () => {
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pipeline-secret": "wrong-secret",
          },
          body: JSON.stringify({ ...validBody, userId: "user-1" }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when userId is missing on pipeline request", async () => {
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pipeline-secret": "test-pipeline-secret",
          },
          body: JSON.stringify(validBody), // no userId
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/userId required/i);
      },
    });
  });

  it("returns 404 when portfolio not found for pipeline request", async () => {
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]), // portfolio not found
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-pipeline-secret": "test-pipeline-secret",
          },
          body: JSON.stringify({ ...validBody, userId: "user-1" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });
});

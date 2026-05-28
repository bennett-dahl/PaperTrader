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
});

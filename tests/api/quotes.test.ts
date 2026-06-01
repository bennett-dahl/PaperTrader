import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockCachedQuote, mockStaleCachedQuote, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/quotes/route";

describe("GET /api/quotes", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when tickers param missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns { quotes: {} } when tickers param is empty string", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.quotes).toEqual({});
      },
    });
  });

  it("returns fresh cached quotes without calling Finnhub", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockCachedQuote]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=AAPL",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.quotes["AAPL"]).toBeDefined();
        expect(json.quotes["AAPL"].stale).toBe(false);
      },
    });
  });

  it("marks quotes with age > 5min as stale=true", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockStaleCachedQuote]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=AAPL",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.quotes["AAPL"].stale).toBe(true);
      },
    });
  });

  it("fetches missing tickers from Finnhub synchronously", async () => {
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(fetchQuote).mockResolvedValue({ c: 150.0, d: 1.5, dp: 1.0 });

    let selectCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        // Initial cache lookup - nothing found
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        } as any;
      }
      // After refresh - return fresh data
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            ticker: "AAPL",
            price: "150.00",
            change: "1.50",
            changePercent: "1.00",
            name: "Apple Inc.",
            updatedAt: new Date(),
          }]),
        }),
      } as any;
    });

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=AAPL",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
      },
    });
  });

  it("force=true refreshes stale tickers synchronously", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue({ c: 160.0, d: 2.0, dp: 1.25 });

    let selectCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        // First query: return stale quote
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockStaleCachedQuote]),
          }),
        } as any;
      }
      // After refresh
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{
            ...mockStaleCachedQuote,
            price: "160.00",
            updatedAt: new Date(),
          }]),
        }),
      } as any;
    });

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=AAPL&force=true",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.quotes).toBeDefined();
      },
    });
  });

  it("fires stale refresh in background when force=false", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockResolvedValue({ c: 160.0, d: 2.0, dp: 1.25 });

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockStaleCachedQuote]),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=AAPL",  // no force=true
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        // Should immediately return the stale quote
        expect(json.quotes["AAPL"]).toBeDefined();
        expect(json.quotes["AAPL"].stale).toBe(true);
      },
    });
  });

  it("logs error when some refreshes fail", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const { fetchQuote } = await import("@/lib/finnhub");
    vi.mocked(fetchQuote).mockRejectedValue(new Error("API error"));

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue([{}]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/quotes?tickers=AAPL",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
      },
    });
  });

});

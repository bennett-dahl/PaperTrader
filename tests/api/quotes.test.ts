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
});

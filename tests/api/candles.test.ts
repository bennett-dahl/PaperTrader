import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/stock/candles/[ticker]/route";

describe("GET /api/stock/candles/[ticker]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when timeframe param missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    process.env.FINNHUB_API_KEY = "test-key";
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when timeframe param is invalid", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    process.env.FINNHUB_API_KEY = "test-key";
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=5D",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 500 when FINNHUB_API_KEY not set", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const savedKey = process.env.FINNHUB_API_KEY;
    delete process.env.FINNHUB_API_KEY;
    
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=1D",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(500);
      },
    });
    
    process.env.FINNHUB_API_KEY = savedKey;
  });
});

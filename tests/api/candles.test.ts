import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { mockSession } from "../fixtures/factories";

// Use vi.hoisted to create a mock that can be used in vi.mock factory
const { mockChart } = vi.hoisted(() => {
  const mockChart = vi.fn();
  return { mockChart };
});

// Mock yahoo-finance2 module
vi.mock("yahoo-finance2", () => ({
  default: class YahooFinance {
    chart = mockChart;
  },
}));

import * as handler from "@/app/api/stock/candles/[ticker]/route";

describe("GET /api/stock/candles/[ticker]", () => {
  beforeEach(() => {
    mockChart.mockReset();
  });

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

  it("returns 502 when yahoo-finance2 throws an error", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockChart.mockRejectedValue(new Error("Yahoo Finance error"));

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=1W",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(502);
      },
    });
  });

  it("returns candles for valid 1W timeframe", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockChart.mockResolvedValue({
      quotes: [
        { date: new Date("2024-01-01"), open: 150, high: 155, low: 148, close: 153, volume: 1000000 },
        { date: new Date("2024-01-02"), open: 153, high: 158, low: 150, close: 156, volume: 1200000 },
      ],
    });

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=1W",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ticker).toBe("AAPL");
        expect(json.timeframe).toBe("1W");
        expect(Array.isArray(json.candles)).toBe(true);
        expect(json.noData).toBe(false);
      },
    });
  });

  it("returns noData=true when quotes array is empty", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockChart.mockResolvedValue({ quotes: [] });

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=1M",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.noData).toBe(true);
        expect(json.candles).toEqual([]);
      },
    });
  });

  it("returns noData=true when all quotes have null prices", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockChart.mockResolvedValue({
      quotes: [
        { date: new Date("2024-01-01"), open: null, high: null, low: null, close: null, volume: 0 },
      ],
    });

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=3M",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.noData).toBe(true);
      },
    });
  });

  it("handles 1D timeframe", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockChart.mockResolvedValue({ quotes: [] });

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      url: "/api/stock/candles/AAPL?timeframe=1D",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
      },
    });
  });

  it("handles 1Y timeframe and uppercases ticker", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockChart.mockResolvedValue({ quotes: [] });

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "tsla" },
      url: "/api/stock/candles/tsla?timeframe=1Y",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ticker).toBe("TSLA");
      },
    });
  });
});

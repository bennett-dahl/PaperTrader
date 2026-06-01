import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/stock/news/[ticker]/route";

describe("GET /api/stock/news/[ticker]", () => {
  beforeEach(() => {
    process.env.FINNHUB_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
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

  it("returns 500 when FINNHUB_API_KEY not set", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    delete process.env.FINNHUB_API_KEY;
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(500);
      },
    });
    process.env.FINNHUB_API_KEY = "test-key";
  });

  it("returns news when Finnhub returns valid data", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const mockNewsData = [
      {
        id: 1,
        headline: "Apple reports record earnings",
        source: "Reuters",
        url: "https://example.com/news/1",
        image: "https://example.com/img/1.jpg",
        datetime: 1700000000,
        summary: "Apple beat expectations...",
      },
      {
        id: 2,
        headline: "iPhone sales strong",
        source: "Bloomberg",
        url: "https://example.com/news/2",
        image: null,
        datetime: 1700001000,
        summary: null,
      },
    ];
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockNewsData,
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ticker).toBe("AAPL");
        expect(Array.isArray(json.news)).toBe(true);
        expect(json.news[0].headline).toBe("Apple reports record earnings");
        expect(json.news[0].source).toBe("Reuters");
      },
    });
  });

  it("returns { news: [] } when Finnhub returns non-ok response", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 503,
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.news).toEqual([]);
      },
    });
  });

  it("returns { news: [] } when Finnhub returns non-array data", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ message: "no data" }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.news).toEqual([]);
      },
    });
  });

  it("returns { news: [] } when fetch throws an error", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.news).toEqual([]);
      },
    });
  });

  it("uppercases ticker in response", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "aapl" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.ticker).toBe("AAPL");
      },
    });
  });

  it("limits news to 10 items", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const manyNews = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      headline: `News ${i}`,
      source: "Test",
      url: `https://example.com/${i}`,
      image: null,
      datetime: 1700000000 + i,
      summary: null,
    }));
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => manyNews,
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.news).toHaveLength(10);
      },
    });
  });
});

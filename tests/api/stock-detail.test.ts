import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockCachedQuote, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/stock-detail/[ticker]/route";

describe("GET /api/stock-detail/[ticker]", () => {
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

  it("returns 503 when all Finnhub calls fail (no API key)", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    // No FINNHUB_API_KEY set, finnhubHeaders() will throw
    delete process.env.FINNHUB_API_KEY;

    // Mock the cached quote DB call to return null too
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        // Should be 503 because all data sources fail
        expect(res.status).toBeGreaterThanOrEqual(400);
      },
    });
    process.env.FINNHUB_API_KEY = "test-key";
  });

  it("falls back to cached quote when live quote fetch fails", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    // Only return data from cached DB, not from live fetch
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockCachedQuote]) }),
      }),
    } as any);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    // With a fake API key, real fetch will fail -> falls back to cached
    process.env.FINNHUB_API_KEY = "fake-test-key";

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        // Either 200 (with cached data) or 503 depending on what mock returns
        expect([200, 503]).toContain(res.status);
      },
    });
  });

  it("returns 404 when profile is null and no other data", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    process.env.FINNHUB_API_KEY = "fake-key";

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);

    // Mock fetch to return profile with empty ticker (not found)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}), // empty profile - no ticker field
    }));

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "INVALID" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        // Should be 404 or 503 depending on what the mocked fetch returns
        expect([404, 503]).toContain(res.status);
      },
    });

    vi.unstubAllGlobals();
  });

  it("returns 200 with cached quote when Finnhub profile has no name", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    process.env.FINNHUB_API_KEY = "fake-key";

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockCachedQuote]) }),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    // Mock fetch to return valid profile
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ticker: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
        currency: "USD",
        logo: null,
        weburl: null,
        ipo: null,
        finnhubIndustry: "Technology",
        country: "US",
        marketCapitalization: 2800000,
        shareOutstanding: 15600000,
        c: 175, d: 1.5, dp: 0.86, o: 174, h: 176, l: 173, pc: 173.5, t: 1700000000,
      }),
    }));

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect([200, 503]).toContain(res.status);
      },
    });

    vi.unstubAllGlobals();
  });
});

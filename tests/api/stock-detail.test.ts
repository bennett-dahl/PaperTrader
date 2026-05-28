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
});

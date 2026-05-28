import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { fetchQuote } from "@/lib/finnhub";

import * as handler from "@/app/api/cron/refresh-quotes/route";

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

describe("GET /api/cron/refresh-quotes", () => {
  it("returns 401 when Authorization header missing", async () => {
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 401 when Authorization header wrong", async () => {
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { authorization: "Bearer wrong-secret" },
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns { message: 'No tickers to refresh', refreshed: 0 } when no holdings/watchlist", async () => {
    vi.mocked(db.selectDistinct).mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { authorization: "Bearer test-secret" },
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.message).toMatch(/no tickers/i);
        expect(json.refreshed).toBe(0);
      },
    });
  });

  it("fetches quotes and reports correct refreshed count", async () => {
    vi.mocked(db.selectDistinct)
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([{ ticker: "AAPL" }]) } as any)
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) } as any);

    vi.mocked(fetchQuote).mockResolvedValue({ c: 175, d: 2, dp: 1.1 });
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { authorization: "Bearer test-secret" },
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.refreshed).toBe(1);
      },
    });
  });
});

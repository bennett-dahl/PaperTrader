import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockPortfolio, mockHolding, mockCachedQuote } from "../fixtures/factories";

import * as handler from "@/app/api/cron/snapshot/route";

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

describe("GET /api/cron/snapshot", () => {
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

  it("handles portfolios with no holdings (totalValue = cashBalance)", async () => {
    const portfolioNoCash = { ...mockPortfolio, cashBalance: "3000.00" };
    vi.mocked(db.select)
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([portfolioNoCash]) } as any)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]), // no holdings
        }),
      } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([{}]),
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
        expect(json.count).toBe(1);
      },
    });
  });

  it("records snapshots and returns count", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([mockPortfolio]) } as any)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockHolding]),
        }),
      } as any)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockCachedQuote]),
        }),
      } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([{}]),
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
        expect(json.count).toBe(1);
        expect(json.message).toMatch(/snapshot/i);
      },
    });
  });
});

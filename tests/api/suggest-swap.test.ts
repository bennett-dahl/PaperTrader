import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockSession, mockStockUniverse } from "../fixtures/factories";

import * as handler from "@/app/api/suggest/swap/route";

describe("POST /api/suggest/swap", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when portfolioId missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tickerToReplace: "AAPL" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when tickerToReplace missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1", tickerToReplace: "AAPL", riskLevel: "low", categories: [], excludeTickers: [] }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when no replacement candidates available", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [mockPortfolio];
          }),
          mockResolvedValue: [],
        }),
      }),
    } as any));

    // Swap needs to return empty from stock universe
    vi.mocked(db.select)
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }) }) } as any)
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }) }) } as any)
      .mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            tickerToReplace: "AAPL",
            riskLevel: "low",
            categories: [],
            excludeTickers: [],
          }),
        });
        expect(res.status).toBe(404);
      },
    });
  });
});

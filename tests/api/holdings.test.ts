import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockHolding, mockCachedQuote, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/holdings/route";

describe("GET /api/holdings", () => {
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

  it("returns 400 when portfolioId param missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/portfolioId/i);
      },
    });
  });

  it("returns 404 when user not found in db", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/holdings?portfolioId=p1",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/user not found/i);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [];
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      url: "/api/holdings?portfolioId=p1",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/portfolio not found/i);
      },
    });
  });

  it("returns 404 when portfolio belongs to different user", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [{ ...mockPortfolio, userId: "other-user-id" }];
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      url: `/api/holdings?portfolioId=${mockPortfolio.id}`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns holdings with cash balance when portfolio is valid", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let selectCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
          }),
        } as any;
      }
      if (selectCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }),
          }),
        } as any;
      }
      if (selectCount === 3) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([mockHolding]),
          }),
        } as any;
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockCachedQuote]),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      url: `/api/holdings?portfolioId=${mockPortfolio.id}`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json.holdings)).toBe(true);
        expect(json.holdings[0].ticker).toBe("AAPL");
        expect(json.holdings[0].name).toBe("Apple Inc.");
        expect(typeof json.cashBalance).toBe("number");
      },
    });
  });

  it("returns empty holdings list when portfolio has no holdings", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let selectCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      selectCount++;
      if (selectCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
          }),
        } as any;
      }
      if (selectCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockPortfolio]) }),
          }),
        } as any;
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      url: `/api/holdings?portfolioId=${mockPortfolio.id}`,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.holdings).toEqual([]);
        expect(json.cashBalance).toBe(parseFloat(mockPortfolio.cashBalance));
      },
    });
  });
});

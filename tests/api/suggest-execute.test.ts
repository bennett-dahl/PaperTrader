import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/suggest/execute/route";

describe("POST /api/suggest/execute", () => {
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
          body: JSON.stringify({ allocations: [{ ticker: "AAPL", shares: 1, price: 150 }] }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when allocations is empty array", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1", allocations: [] }),
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
          body: JSON.stringify({ portfolioId: "p1", allocations: [{ ticker: "AAPL", shares: 1, price: 150 }] }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("executes allocations and returns successCount + failCount + results", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [{ ...mockPortfolio, cashBalance: "5000.00" }];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [{ ...mockPortfolio, cashBalance: "5000.00" }];
                return []; // no existing holding
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([{}]),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{}]),
          }),
        }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            allocations: [{ ticker: "AAPL", shares: 2, price: 150 }],
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.successCount).toBe(1);
        expect(json.failCount).toBe(0);
        expect(Array.isArray(json.results)).toBe(true);
      },
    });
  });

  it("marks allocation as failed when ticker/shares/price invalid", async () => {
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
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            allocations: [{ ticker: "AAPL", shares: 0, price: 150 }], // invalid shares
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.failCount).toBe(1);
        expect(json.successCount).toBe(0);
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
            return []; // portfolio not found
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1", allocations: [{ ticker: "AAPL", shares: 1, price: 150 }] }),
        });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/portfolio not found/i);
      },
    });
  });

  it("marks allocation as failed when insufficient cash", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [mockPortfolio]; // has $3000 cash
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ ...mockPortfolio, cashBalance: "10.00" }]), // only $10
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            allocations: [{ ticker: "AAPL", shares: 100, price: 150 }], // $15000 but only $10
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.failCount).toBe(1);
        expect(json.results[0].success).toBe(false);
        expect(json.results[0].error).toMatch(/insufficient cash/i);
      },
    });
  });

  it("handles existing holding by updating average cost basis", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [{ ...mockPortfolio, cashBalance: "5000.00" }];
          }),
        }),
      }),
    } as any));

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      let txCount = 0;
      const existingHolding = { id: "h1", portfolioId: mockPortfolio.id, ticker: "AAPL", shares: "5.0000", avgCostBasis: "140.00" };
      const txMock = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockImplementation(async () => {
                txCount++;
                if (txCount === 1) return [{ ...mockPortfolio, cashBalance: "5000.00" }];
                return [existingHolding]; // existing holding
              }),
            }),
          }),
        })),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{}]) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{}]) }) }),
      };
      return fn(txMock);
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            portfolioId: mockPortfolio.id,
            allocations: [{ ticker: "AAPL", shares: 2, price: 150 }],
          }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.successCount).toBe(1);
      },
    });
  });
});

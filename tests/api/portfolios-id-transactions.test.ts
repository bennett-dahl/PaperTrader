import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockSession, mockTransaction } from "../fixtures/factories";

import * as handler from "@/app/api/portfolios/[id]/transactions/route";

// `@/auth` and `@/db` are mocked globally in tests/setup.ts. Do not re-mock
// here without a factory — an auto-mock would import the real next-auth and
// fail to resolve "next/server" in the test environment.

function setupAuth(authed = true) {
  vi.mocked(auth).mockResolvedValue(authed ? (mockSession as any) : null);
}

// drizzle's `where` condition graph contains circular references, so a plain
// JSON.stringify throws. This drops already-seen objects while preserving leaf
// values (the uppercased ticker we want to assert on).
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return v;
  });
}

describe("GET /api/portfolios/[id]/transactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    setupAuth(false);
    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when user not found in DB", async () => {
    setupAuth();
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/user not found/i);
      },
    });
  });

  it("returns 404 when portfolio not owned by authenticated user", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return []; // portfolio not found / not owned
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      params: { id: "other-portfolio-id" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 200 with array of transactions for valid owned portfolio", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    // Mock db.query.transactions.findMany
    vi.mocked(db).query = {
      transactions: {
        findMany: vi.fn().mockResolvedValue([
          { ...mockTransaction, pipeline: null },
        ]),
      },
    } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(Array.isArray(json)).toBe(true);
        expect(json[0]).toMatchObject({
          id: mockTransaction.id,
          ticker: mockTransaction.ticker,
          type: mockTransaction.type,
          pipelineName: null,
        });
      },
    });
  });

  it("normalizes ?ticker=nvda to NVDA uppercase", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    const findMany = vi.fn().mockResolvedValue([]);
    vi.mocked(db).query = { transactions: { findMany } } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      url: `/api/portfolios/${mockPortfolio.id}/transactions?ticker=nvda`,
      test: async ({ fetch }) => {
        await fetch({ method: "GET" });
        const callArgs = findMany.mock.calls[0][0];
        const whereStr = safeStringify(callArgs.where ?? callArgs);
        expect(findMany).toHaveBeenCalledOnce();
        expect(whereStr).toContain('"NVDA"');
        expect(whereStr).not.toContain('"nvda"');
      },
    });
  });

  it("includes pipelineName from joined pipeline", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    vi.mocked(db).query = {
      transactions: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...mockTransaction,
            pipelineId: "pipeline-uuid-1",
            pipeline: { id: "pipeline-uuid-1", name: "Kronos Pure Signal" },
          },
        ]),
      },
    } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        const json = await res.json();
        expect(json[0].pipelineName).toBe("Kronos Pure Signal");
      },
    });
  });

  it("returns pipelineName: null for manual trades", async () => {
    setupAuth();
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));

    vi.mocked(db).query = {
      transactions: {
        findMany: vi.fn().mockResolvedValue([
          { ...mockTransaction, pipelineId: null, pipeline: null },
        ]),
      },
    } as any;

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPortfolio.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        const json = await res.json();
        expect(json[0].pipelineName).toBeNull();
      },
    });
  });
});

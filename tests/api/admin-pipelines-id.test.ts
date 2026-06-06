import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockUser } from "../fixtures/factories";

const VALID_SECRET = "test-pipeline-secret";

const mockPipeline = {
  id: "pipeline-1",
  userId: mockUser.id,
  name: "Test Pipeline",
  status: "active",
  thesis: "Some thesis",
  strategyType: "thesis_driven",
  tickerUniverse: [],
  maxPositions: 10,
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.65",
  autonomous: true,
  allowShortSell: false,
  rebalanceOnRun: false,
  hypothesisConfig: null,
  configOverrides: [],
  templateId: null,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date(),
};

function setupAdminEnv() {
  process.env.PIPELINE_SECRET = VALID_SECRET;
  process.env.ADMIN_USER_EMAIL = "admin@example.com";
}

function authHeader() {
  return { Authorization: `Bearer ${VALID_SECRET}` };
}

describe("PATCH /api/admin/pipelines/[id]", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with bad auth", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 for invalid status string", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ status: "invalid-status" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/status/i);
      },
    });
  });

  it("returns 404 when pipeline not found", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(callCount === 1 ? [mockUser] : []),
          }),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      params: { id: "nonexistent" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("updates status successfully and sets updatedAt", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(callCount === 1 ? [mockUser] : [mockPipeline]),
          }),
        }),
      } as any;
    });

    const updatedPipeline = { ...mockPipeline, status: "paused", updatedAt: new Date() };
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updatedPipeline]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.pipeline).toBeDefined();
      },
    });
  });
});

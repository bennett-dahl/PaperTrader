import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockUser } from "../fixtures/factories";

// QStash mock must appear before any handler import
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.publishJSON = vi.fn().mockResolvedValue({ messageId: "msg-123" });
  }),
}));

const VALID_SECRET = "test-pipeline-secret";
const VALID_EMAIL = "admin@example.com";

function setupAdminEnv() {
  process.env.PIPELINE_SECRET = VALID_SECRET;
  process.env.ADMIN_USER_EMAIL = VALID_EMAIL;
  process.env.QSTASH_TOKEN = "test-qstash-token";
  process.env.NEXTAUTH_URL = "http://localhost:3000";
}

function authHeader() {
  return { Authorization: `Bearer ${VALID_SECRET}` };
}

// ─── Shared mock data ──────────────────────────────────────────────────────────

const mockPipeline = {
  id: "pipeline-ops-1",
  userId: mockUser.id,
  templateId: null,
  name: "Ops Test Pipeline",
  status: "active",
  thesis: "Test thesis.",
  strategyType: "kronos_rotation",
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
  kronosTickerUniverse: [],
  kronosRebalancePct: "50.00",
  kronosMinSignalPct: "2.00",
  lastRunAt: null,
  nextRunAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const mockRun = {
  id: "run-uuid-1",
  pipelineId: "pipeline-ops-1",
  status: "completed",
  triggeredBy: "manual",
  tickersEvaluated: 5,
  tradesExecuted: 2,
  tradesSkipped: 3,
  tradesFailed: 0,
  errorMessage: null,
  startedAt: new Date("2025-06-01T12:00:00Z"),
  completedAt: new Date("2025-06-01T12:05:00Z"),
  durationMs: 300000,
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: "0.015000",
  forecastsLoadedAt: new Date("2025-06-01T11:55:00Z"),
  forecastToRunGapMs: 300000,
};

const mockDecision = {
  id: "decision-uuid-1",
  runId: "run-uuid-1",
  pipelineId: "pipeline-ops-1",
  portfolioId: null,
  ticker: "AAPL",
  action: "BUY",
  confidence: "0.85",
  shares: "10.000000",
  priceAtDecision: "175.0000",
  reasoning: "Strong earnings beat.",
  signalSummary: null,
  executed: true,
  executionError: null,
  decidedAt: new Date("2025-06-01T12:01:00Z"),
};

// ── POST /api/admin/pipelines/:id/trigger ─────────────────────────────────────
describe("POST /api/admin/pipelines/:id/trigger", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with no auth header", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/trigger/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "POST" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 401 with wrong token", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/trigger/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { Authorization: "Bearer wrong" },
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when pipeline not found or not owned", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/trigger/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : []
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "nonexistent-pipeline" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: authHeader(),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("happy path — queues pipeline run and returns 202", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/trigger/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : [mockPipeline]
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: authHeader(),
        });
        expect(res.status).toBe(202);
        const data = await res.json();
        expect(data.queued).toBe(true);
        expect(data.pipelineId).toBe("pipeline-ops-1");
      },
    });

    // Verify QStash received the right payload
    const { Client } = await import("@upstash/qstash");
    const instance = (Client as any).mock.instances[0];
    expect(instance.publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { pipelineId: "pipeline-ops-1", triggeredBy: "manual" },
      })
    );
  });
});

// ── GET /api/admin/pipelines/:id/runs ─────────────────────────────────────────
describe("GET /api/admin/pipelines/:id/runs", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with missing/invalid token", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when pipeline not found or not owned", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : []
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "no-such-pipeline" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("happy path — returns paginated runs with total", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // user lookup
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockUser]),
            }),
          }),
        } as any;
      }
      if (callCount === 2) {
        // pipeline ownership
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockPipeline]),
            }),
          }),
        } as any;
      }
      if (callCount === 3) {
        // count query: .from().where() resolves directly
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          }),
        } as any;
      }
      // runs query: .from().where().orderBy().limit().offset()
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockResolvedValue([mockRun]),
              }),
            }),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data.runs)).toBe(true);
        expect(data.runs).toHaveLength(1);
        expect(data.total).toBe(1);
        expect(data.runs[0].id).toBe("run-uuid-1");
        expect(data.runs[0].forecastsLoadedAt).toBeDefined();
        expect(data.runs[0].forecastToRunGapMs).toBe(300000);
      },
    });
  });
});

// ── GET /api/admin/pipelines/:id/runs/:runId/decisions ────────────────────────
describe("GET /api/admin/pipelines/:id/runs/:runId/decisions", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with missing/invalid token", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/decisions/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when pipeline not found or not owned", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/decisions/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : []
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "no-such", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when run not found or not in pipeline", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/decisions/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : callCount === 2 ? [mockPipeline] : []
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1", runId: "no-such-run" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("happy path — returns decisions and run", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/decisions/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockUser]),
            }),
          }),
        } as any;
      }
      if (callCount === 2) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockPipeline]),
            }),
          }),
        } as any;
      }
      if (callCount === 3) {
        // run membership
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockRun]),
            }),
          }),
        } as any;
      }
      // decisions: .from().where() resolves directly
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockDecision]),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data.decisions)).toBe(true);
        expect(data.decisions).toHaveLength(1);
        expect(data.decisions[0].ticker).toBe("AAPL");
        expect(data.run.id).toBe("run-uuid-1");
      },
    });
  });
});

// ── GET /api/admin/pipelines/:id/runs/:runId/forecasts ────────────────────────
describe("GET /api/admin/pipelines/:id/runs/:runId/forecasts", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with missing/invalid token", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/forecasts/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when pipeline not found or not owned", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/forecasts/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : []
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "no-such", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when run not found or not in pipeline", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/forecasts/route");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(
              callCount === 1 ? [mockUser] : callCount === 2 ? [{ kronosMinSignalPct: "2.00" }] : []
            ),
          }),
        }),
      } as any;
    });
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1", runId: "no-such-run" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("happy path — returns classified forecasts sorted descending by predictedReturnPct", async () => {
    const handler = await import("@/app/api/admin/pipelines/[id]/runs/[runId]/forecasts/route");

    const mockForecastRows = [
      { ticker: "NVDA", predictedReturnPct: "3.50", forecastDate: "2025-06-01" }, // buy (>2.00)
      { ticker: "AAPL", predictedReturnPct: "0.50", forecastDate: "2025-06-01" }, // hold
      { ticker: "META", predictedReturnPct: "-3.00", forecastDate: "2025-06-01" }, // sell (<-2.00)
    ];

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // user lookup
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockUser]),
            }),
          }),
        } as any;
      }
      if (callCount === 2) {
        // pipeline ownership — returns { kronosMinSignalPct }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ kronosMinSignalPct: "2.00" }]),
            }),
          }),
        } as any;
      }
      if (callCount === 3) {
        // run membership — returns { startedAt }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ startedAt: new Date("2025-06-01T12:00:00Z") }]),
            }),
          }),
        } as any;
      }
      // kronosForecasts query: .from().where() resolves directly
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockForecastRows),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-ops-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.kronosMinSignalPct).toBe(2.0);
        expect(Array.isArray(data.forecasts)).toBe(true);
        expect(data.forecasts).toHaveLength(3);
        // Sorted descending
        expect(data.forecasts[0].ticker).toBe("NVDA");
        expect(data.forecasts[0].signal).toBe("buy");
        expect(data.forecasts[1].ticker).toBe("AAPL");
        expect(data.forecasts[1].signal).toBe("hold");
        expect(data.forecasts[2].ticker).toBe("META");
        expect(data.forecasts[2].signal).toBe("sell");
      },
    });
  });
});

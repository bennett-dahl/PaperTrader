# Spec: Admin Endpoints for Pipeline Operations

**Status:** Ready for implementation  
**Date:** 2026-06-08  
**Scope:** Four new admin API routes + one test file

---

## Overview

Add four admin-auth equivalents of existing session-auth pipeline endpoints. All routes live under `/api/admin/pipelines/` and use `requireAdminUser` from `src/app/api/admin/_auth.ts` (Bearer token check against `PIPELINE_SECRET` env var, user resolved from `ADMIN_USER_EMAIL`).

No database migrations required — all operations use existing tables (`pipelines`, `pipelineRuns`, `decisionLog`, `kronosForecasts`).

---

## Context & Codebase Notes

### Auth pattern (`requireAdminUser`)

```ts
// src/app/api/admin/_auth.ts
export async function requireAdminUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.PIPELINE_SECRET}`) return null;
  const email = process.env.ADMIN_USER_EMAIL;
  if (!email) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}
```

Returns `null` on failure; callers return `401`.

### Existing session-auth routes to mirror

| New admin route | Mirrors |
|---|---|
| `POST /api/admin/pipelines/:id/trigger` | `POST /api/pipelines/:id/trigger/route.ts` |
| `GET /api/admin/pipelines/:id/runs` | `GET /api/pipelines/:id/runs/route.ts` |
| `GET /api/admin/pipelines/:id/runs/:runId/decisions` | `GET /api/pipelines/:id/runs/:runId/decisions/route.ts` |
| `GET /api/admin/pipelines/:id/runs/:runId/forecasts` | `GET /api/pipelines/:id/runs/:runId/forecasts/route.ts` |

### Key gap in existing forecasts route

The session-auth forecasts endpoint (`src/app/api/pipelines/[id]/runs/[runId]/forecasts/route.ts`) has **zero auth**. It also does not verify that the `runId` actually belongs to the given `pipelineId`. The admin version must:
1. Verify ownership (pipeline belongs to admin user)
2. Verify the run belongs to the pipeline
3. Only then return forecasts

### QStash client

```ts
import { Client as QStashClient } from "@upstash/qstash";
const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
```

Base URL resolution:
```ts
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : process.env.NEXTAUTH_URL!;
```

---

## Files to Create

```
src/app/api/admin/pipelines/[id]/trigger/route.ts
src/app/api/admin/pipelines/[id]/runs/route.ts
src/app/api/admin/pipelines/[id]/runs/[runId]/decisions/route.ts
src/app/api/admin/pipelines/[id]/runs/[runId]/forecasts/route.ts
tests/api/admin-pipeline-ops.test.ts
```

---

## Route Implementations

### 1. `src/app/api/admin/pipelines/[id]/trigger/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { Client as QStashClient } from "@upstash/qstash";
import { requireAdminUser } from "../../../_auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXTAUTH_URL!;

  await qstash.publishJSON({
    url: `${baseUrl}/api/pipeline/run`,
    body: { pipelineId: pipeline.id, triggeredBy: "manual" },
    headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET! },
    retries: 1,
    deduplicationId: `pipeline-manual-${pipeline.id}-${Date.now()}`,
  });

  return NextResponse.json({ queued: true, pipelineId: pipeline.id }, { status: 202 });
}
```

**Response:** `202 { queued: true, pipelineId: string }`

---

### 2. `src/app/api/admin/pipelines/[id]/runs/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns } from "@/db/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAdminUser } from "../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "20");
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const [totalRow] = await db
    .select({ count: count() })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id));

  const runs = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ runs, total: Number(totalRow.count) });
}
```

**Query params:** `?limit` (default 20), `?offset` (default 0)  
**Response:** `200 { runs: PipelineRun[], total: number }`

---

### 3. `src/app/api/admin/pipelines/[id]/runs/[runId]/decisions/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns, decisionLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdminUser } from "../../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, runId } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const [run] = await db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, id)))
    .limit(1);

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const decisions = await db
    .select()
    .from(decisionLog)
    .where(eq(decisionLog.runId, runId));

  return NextResponse.json({ decisions, run });
}
```

**Response:** `200 { decisions: DecisionLog[], run: PipelineRun }`

---

### 4. `src/app/api/admin/pipelines/[id]/runs/[runId]/forecasts/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns, kronosForecasts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdminUser } from "../../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: pipelineId, runId } = await params;

  // Ownership check — also grab kronosMinSignalPct while we're here
  const [pipeline] = await db
    .select({ kronosMinSignalPct: pipelines.kronosMinSignalPct })
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  // Run membership check — also grab startedAt for forecastDate derivation
  const [run] = await db
    .select({ startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, pipelineId)))
    .limit(1);

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const forecastDate = run.startedAt.toISOString().split("T")[0];
  const kronosMinSignalPct = parseFloat(pipeline.kronosMinSignalPct ?? "1.00");

  const rows = await db
    .select({
      ticker: kronosForecasts.ticker,
      predictedReturnPct: kronosForecasts.predictedReturnPct,
      forecastDate: kronosForecasts.forecastDate,
    })
    .from(kronosForecasts)
    .where(
      and(
        eq(kronosForecasts.pipelineId, pipelineId),
        eq(kronosForecasts.forecastDate, forecastDate)
      )
    );

  const forecasts = rows
    .map((r) => {
      const pct = parseFloat(r.predictedReturnPct);
      const signal: "buy" | "sell" | "hold" =
        pct > kronosMinSignalPct ? "buy" : pct < -kronosMinSignalPct ? "sell" : "hold";
      return {
        ticker: r.ticker,
        predictedReturnPct: pct,
        forecastDate: r.forecastDate,
        signal,
      };
    })
    .sort((a, b) => b.predictedReturnPct - a.predictedReturnPct);

  return NextResponse.json({ forecasts, kronosMinSignalPct });
}
```

**Response:** `200 { forecasts: Array<{ ticker, predictedReturnPct, forecastDate, signal }>, kronosMinSignalPct: number }`

Signal classification: `pct > kronosMinSignalPct` → `"buy"`, `pct < -kronosMinSignalPct` → `"sell"`, else `"hold"`. Results sorted descending by `predictedReturnPct`.

---

## Test File: `tests/api/admin-pipeline-ops.test.ts`

All four endpoints in one file. Follows the pattern from `tests/api/admin-portfolios.test.ts` and `tests/api/admin-pipelines.test.ts`.

```ts
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
```

---

## Gaps & Decisions

| # | Gap / Decision | Resolution |
|---|---|---|
| 1 | **Existing forecasts endpoint has no auth** | Admin version adds `requireAdminUser` + pipeline ownership + run membership check. This is a deliberate improvement — the session-auth version also lacks run-belongs-to-pipeline verification and should be patched separately. |
| 2 | **Forecasts: what if run has no kronosForecasts rows?** | Return `{ forecasts: [], kronosMinSignalPct }` — same behavior as original. 404 is for a missing run, not missing forecast rows. |
| 3 | **`kronosMinSignalPct` null handling** | `?? "1.00"` fallback — consistent with existing pipeline routes. |
| 4 | **QStash mock must be hoisted** | `vi.mock("@upstash/qstash", ...)` must appear at module top-level in the test file. Vitest hoists `vi.mock` but the constructable mock (regular function, not arrow) is required because the trigger route calls `new QStashClient(...)`. Pattern copied from `tests/api/pipeline-orchestrator.test.ts`. |
| 5 | **Pagination: no upper-bound validation** | Consistent with the existing session-auth runs route. Add bounds (`Math.min(limit, 100)`) in a follow-up if needed. |
| 6 | **`params` is a Promise (Next.js 15)** | All four routes must `await params` before destructuring. This is the existing pattern across all admin routes in this codebase. |
| 7 | **Forecasts route: partial select on pipeline** | The admin forecasts route selects only `{ kronosMinSignalPct }` from `pipelines` rather than `select()` for the full row. This is intentional — same query, less data. The ownership check uses `and(eq(pipelines.id, pipelineId), eq(pipelines.userId, user.id))`. |

---

## Import Reference

### Auth import depth

| Route file | `_auth.ts` relative path |
|---|---|
| `[id]/trigger/route.ts` | `../../../_auth` |
| `[id]/runs/route.ts` | `../../../_auth` |
| `[id]/runs/[runId]/decisions/route.ts` | `../../../../_auth` |
| `[id]/runs/[runId]/forecasts/route.ts` | `../../../../_auth` |

### Drizzle imports per route

```ts
// trigger
import { pipelines } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// runs
import { pipelines, pipelineRuns } from "@/db/schema";
import { eq, and, desc, count } from "drizzle-orm";

// decisions
import { pipelines, pipelineRuns, decisionLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// forecasts
import { pipelines, pipelineRuns, kronosForecasts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
```

---

## Acceptance Criteria

- [ ] All four routes return `401` for missing or wrong `Authorization: Bearer` header
- [ ] All four routes return `404` when pipeline doesn't exist or `userId ≠ admin user`
- [ ] Decisions and forecasts routes return `404` when `runId` doesn't exist or doesn't belong to the pipeline
- [ ] Trigger route publishes to QStash with `{ pipelineId, triggeredBy: "manual" }` and returns `202 { queued: true, pipelineId }`
- [ ] Runs route respects `?limit` / `?offset` and returns `{ runs: PipelineRun[], total: number }`
- [ ] Decisions route returns `{ decisions: DecisionLog[], run: PipelineRun }`
- [ ] Forecasts route returns `{ forecasts, kronosMinSignalPct }` with correct signal classification (`buy`/`sell`/`hold`) and descending sort
- [ ] All 14 test cases pass: 4 (trigger) + 3 (runs) + 4 (decisions) + 4 (forecasts) — wait, re-count: 3+3+4+4 = 14
- [ ] `vitest run` passes with no new coverage regressions

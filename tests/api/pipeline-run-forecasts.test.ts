import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/pipelines/[id]/runs/[runId]/forecasts/route";

const mockPipeline = {
  id: "pipeline-uuid-1",
  userId: mockUser.id,
  kronosMinSignalPct: "2.00",
};

const mockRun = {
  id: "run-uuid-1",
  pipelineId: "pipeline-uuid-1",
  startedAt: new Date("2026-06-15T20:00:00Z"),
};

const mockForecasts = [
  { ticker: "AAPL", predictedReturnPct: "3.50", forecastDate: "2026-06-15" },
  { ticker: "NVDA", predictedReturnPct: "-3.00", forecastDate: "2026-06-15" },
  { ticker: "MSFT", predictedReturnPct: "1.00", forecastDate: "2026-06-15" },
];

/** Creates a mock chain that resolves to `value` at `.limit()`, `.orderBy()`, or via direct `await`. */
function chain(value: unknown) {
  const thenable = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve),
    limit: vi.fn().mockResolvedValue(value),
    orderBy: vi.fn().mockResolvedValue(value),
  };
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(thenable),
    }),
  };
}

function setupSelectSequence(...results: unknown[][]) {
  let idx = 0;
  vi.mocked(db.select).mockImplementation(() => chain(results[idx++] ?? []) as any);
}

describe("GET /api/pipelines/[id]/runs/[runId]/forecasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-uuid-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 401 when user not in DB", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([]); // user lookup returns empty
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-uuid-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when pipeline not found or not owned by user", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([mockUser], []); // user found, pipeline not found
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-uuid-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns empty forecasts when run not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([mockUser], [mockPipeline], []); // user, pipeline, no run
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-uuid-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ forecasts: [], kronosMinSignalPct: 1.0 });
      },
    });
  });

  it("returns forecasts with signals sorted by predictedReturnPct", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([mockUser], [mockPipeline], [mockRun], mockForecasts);
    await testApiHandler({
      appHandler: handler,
      params: { id: "pipeline-uuid-1", runId: "run-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.kronosMinSignalPct).toBe(2.0);
        // Sorted descending by predictedReturnPct
        expect(body.forecasts[0].ticker).toBe("AAPL");
        expect(body.forecasts[0].signal).toBe("buy");   // 3.5 > 2.0
        expect(body.forecasts[1].ticker).toBe("MSFT");
        expect(body.forecasts[1].signal).toBe("hold");  // 1.0 is between -2.0 and 2.0
        expect(body.forecasts[2].ticker).toBe("NVDA");
        expect(body.forecasts[2].signal).toBe("sell");  // -3.0 < -2.0
      },
    });
  });
});

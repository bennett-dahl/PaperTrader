import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";

// Mock QStash client — must use a regular function (not arrow) so it's constructable with `new`
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.publishJSON = vi.fn().mockResolvedValue({ messageId: "msg-1" });
  }),
}));

// Mock the shared Kronos prefetch lib — keeps orchestrator tests isolated
vi.mock("@/lib/run-kronos-prefetch", () => ({
  runKronosPrefetch: vi.fn().mockResolvedValue({ upserted: 0, skipped: 0, errors: [] }),
}));

import * as handler from "@/app/api/cron/pipeline-orchestrator/route";
import { runKronosPrefetch } from "@/lib/run-kronos-prefetch";

describe("GET /api/cron/pipeline-orchestrator", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.QSTASH_TOKEN = "test-qstash-token";
    process.env.PIPELINE_SECRET = "test-pipeline-secret";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    vi.mocked(runKronosPrefetch).mockResolvedValue({ upserted: 0, skipped: 0, errors: [] });
  });

  it("returns 401 without valid CRON_SECRET", async () => {
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer wrong-secret" },
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 401 without authorization header", async () => {
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("dispatches jobs for active pipelines", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pipeline-1", name: "Pipeline 1" },
          { id: "pipeline-2", name: "Pipeline 2" },
        ]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.dispatched).toBe(2);
        expect(data.failed).toBe(0);
      },
    });
  });

  it("returns dispatched=0 when no active pipelines", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.dispatched).toBe(0);
      },
    });
  });

  it("counts failed dispatches when QStash throws", async () => {
    const { Client } = await import("@upstash/qstash");
    vi.mocked(Client).mockImplementationOnce(function (this: Record<string, unknown>) {
      this.publishJSON = vi.fn().mockRejectedValue(new Error("QStash error"));
    } as any);

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pipeline-1", name: "Pipeline 1" },
        ]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.failed).toBe(1);
        expect(data.dispatched).toBe(0);
      },
    });
  });

  // ── Kronos prefetch integration ──────────────────────────────────────────

  it("calls runKronosPrefetch before dispatching pipelines", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "pipeline-1", name: "P1" }]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        expect(vi.mocked(runKronosPrefetch)).toHaveBeenCalledOnce();
      },
    });
  });

  it("includes kronosPrefetch stats in response", async () => {
    vi.mocked(runKronosPrefetch).mockResolvedValueOnce({
      upserted: 5,
      skipped: 1,
      errors: ["pipeline x: Modal HTTP 500"],
    });

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.kronosPrefetch).toMatchObject({
          upserted: 5,
          skipped: 1,
          errors: 1,
        });
      },
    });
  });

  it("continues dispatching pipelines when kronos prefetch throws", async () => {
    vi.mocked(runKronosPrefetch).mockRejectedValueOnce(
      new Error("Modal not configured")
    );

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "pipeline-1", name: "Pipeline 1" },
          { id: "pipeline-2", name: "Pipeline 2" },
        ]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        // Dispatch should still succeed despite prefetch failure
        expect(data.dispatched).toBe(2);
        expect(data.failed).toBe(0);
        // Prefetch stats reflect the error (zeroed out)
        expect(data.kronosPrefetch).toMatchObject({ upserted: 0, errors: 0 });
      },
    });
  });

  it("returns zero kronosPrefetch stats when prefetch throws", async () => {
    vi.mocked(runKronosPrefetch).mockRejectedValueOnce(new Error("Modal down"));

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer test-cron-secret" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.kronosPrefetch).toEqual({ upserted: 0, skipped: 0, errors: 0 });
      },
    });
  });
});

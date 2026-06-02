import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";

// Mock QStash client — must use a regular function (not arrow) so it's constructable with `new`
vi.mock("@upstash/qstash", () => ({
  Client: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.publishJSON = vi.fn().mockResolvedValue({ messageId: "msg-1" });
  }),
}));

import * as handler from "@/app/api/cron/pipeline-orchestrator/route";

describe("GET /api/cron/pipeline-orchestrator", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.QSTASH_TOKEN = "test-qstash-token";
    process.env.PIPELINE_SECRET = "test-pipeline-secret";
    process.env.NEXTAUTH_URL = "http://localhost:3000";
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
});

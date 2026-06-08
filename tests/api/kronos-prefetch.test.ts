import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";

// Mock QStash verification
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: (handler: unknown) => handler,
}));

import * as handler from "@/app/api/pipeline/kronos-prefetch/route";

const mockPipeline = {
  id: "pipeline-1",
  kronosTickerUniverse: ["AAPL", "MSFT"],
};

beforeEach(() => {
  process.env.MODAL_API_URL = "https://modal.example.com/forecast";
  process.env.KRONOS_SECRET = "test-secret";
});

describe("POST /api/pipeline/kronos-prefetch", () => {
  it("returns { ok: true, upserted: 0 } when no active kronos_rotation pipelines", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "POST" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.upserted).toBe(0);
      },
    });
  });

  it("returns 500 when MODAL_API_URL is not configured", async () => {
    delete process.env.MODAL_API_URL;

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockPipeline]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "POST" });
        expect(res.status).toBe(500);
        const data = await res.json();
        expect(data.error).toBeTruthy();
      },
    });
  });

  it("upserts forecasts and returns correct upserted count on success", async () => {
    const mockResults = [
      { ticker: "AAPL", predictedReturnPct: 2.5 },
      { ticker: "MSFT", predictedReturnPct: -1.2 },
    ];

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockPipeline]),
      }),
    } as any);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: mockResults }),
      })
    );

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch: testFetch }) => {
        const res = await testFetch({ method: "POST" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.upserted).toBe(2);
      },
    });
  });

  it("skips pipeline with empty kronosTickerUniverse and does not call Modal", async () => {
    const emptyUniversePipeline = { id: "pipeline-2", kronosTickerUniverse: [] };

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([emptyUniversePipeline]),
      }),
    } as any);

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch: testFetch }) => {
        const res = await testFetch({ method: "POST" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.upserted).toBe(0);
        expect(mockFetch).not.toHaveBeenCalled();
      },
    });
  });

  it("logs error and skips pipeline when Modal returns HTTP 500", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockPipeline]),
      }),
    } as any);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch: testFetch }) => {
        const res = await testFetch({ method: "POST" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.upserted).toBe(0);
        expect(consoleSpy).toHaveBeenCalled();
      },
    });

    consoleSpy.mockRestore();
  });

  it("logs warning and skips DB writes when Modal returns empty results", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockPipeline]),
      }),
    } as any);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      })
    );

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch: testFetch }) => {
        const res = await testFetch({ method: "POST" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.upserted).toBe(0);
        expect(consoleSpy).toHaveBeenCalled();
      },
    });

    consoleSpy.mockRestore();
  });

  it("continues processing remaining pipelines when one fails", async () => {
    const pipeline2 = { id: "pipeline-2", kronosTickerUniverse: ["NVDA"] };

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([mockPipeline, pipeline2]),
      }),
    } as any);

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ results: [{ ticker: "NVDA", predictedReturnPct: 3.1 }] }),
        });
      })
    );

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch: testFetch }) => {
        const res = await testFetch({ method: "POST" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);
        // pipeline1 failed, pipeline2 succeeded with 1 forecast
        expect(data.upserted).toBe(1);
      },
    });
  });
});

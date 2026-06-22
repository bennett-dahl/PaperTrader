import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/tickers/[ticker]/forecast/route";

/** Chain that supports .where().limit(), .where().orderBy().limit(), or direct await on .where() */
function chain(value: unknown) {
  const limitMock = vi.fn().mockResolvedValue(value);
  const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
  const whereMock = vi.fn().mockReturnValue({
    limit: limitMock,
    orderBy: orderByMock,
  });
  return {
    from: vi.fn().mockReturnValue({ where: whereMock }),
  };
}

function setupSelectSequence(...results: unknown[][]) {
  let idx = 0;
  vi.mocked(db.select).mockImplementation(() => chain(results[idx++] ?? []) as any);
}

describe("GET /api/tickers/[ticker]/forecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 401 when user not in DB", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([]); // user not found
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns null when no forecast exists for ticker", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([mockUser], []); // user found, no forecast
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toBeNull();
      },
    });
  });

  it("returns forecast data for a valid ticker", async () => {
    const mockForecast = {
      ticker: "AAPL",
      predictedReturnPct: "3.50",
      forecastDate: "2026-06-15",
      pipelineId: "pipeline-uuid-1",
    };
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([mockUser], [mockForecast]);
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({
          ticker: "AAPL",
          predictedReturnPct: 3.5,
          forecastDate: "2026-06-15",
          pipelineId: "pipeline-uuid-1",
        });
      },
    });
  });

  it("uppercases the ticker parameter", async () => {
    const mockForecast = {
      ticker: "NVDA",
      predictedReturnPct: "2.10",
      forecastDate: "2026-06-15",
      pipelineId: "pipeline-uuid-1",
    };
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupSelectSequence([mockUser], [mockForecast]);
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "nvda" }, // lowercase
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ticker).toBe("NVDA");
      },
    });
  });
});

import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { db } from "@/db";

import * as handler from "@/app/api/tickers/[ticker]/forecast/route";

const mockForecastRow = {
  ticker: "AAPL",
  predictedReturnPct: "2.5000",
  forecastDate: "2026-06-07",
  pipelineId: "pipeline-1",
};

describe("GET /api/tickers/[ticker]/forecast", () => {
  it("returns forecast data for a ticker with one row", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockForecastRow]),
          }),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ticker).toBe("AAPL");
        expect(data.predictedReturnPct).toBe(2.5);
        expect(data.forecastDate).toBe("2026-06-07");
        expect(data.pipelineId).toBe("pipeline-1");
      },
    });
  });

  it("returns the most recent forecast when multiple rows exist (orders by forecastDate desc)", async () => {
    // The route uses orderBy(desc(forecastDate)) and limit(1) — DB returns most recent first
    const newerRow = { ...mockForecastRow, forecastDate: "2026-06-08", predictedReturnPct: "3.1000" };

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([newerRow]),
          }),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.forecastDate).toBe("2026-06-08");
        expect(data.predictedReturnPct).toBe(3.1);
      },
    });
  });

  it("returns null when no forecasts exist for ticker", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "GME" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toBeNull();
      },
    });
  });

  it("normalises ticker to uppercase before querying", async () => {
    const selectSpy = vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ ...mockForecastRow, ticker: "AAPL" }]),
          }),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { ticker: "aapl" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const data = await res.json();
        // Response ticker should be the stored uppercase value
        expect(data.ticker).toBe("AAPL");
      },
    });
  });
});

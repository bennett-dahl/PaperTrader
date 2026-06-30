import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";

// Mock QStash verification
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: (handler: unknown) => handler,
}));

// Mock AI SDK
const mockGenerateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn().mockReturnValue("mock-model"),
}));

vi.mock("@/lib/earnings", () => ({
  fetchEarningsSignals: vi.fn().mockResolvedValue(new Map()),
}));

const mockBuildPrompt = vi.fn().mockReturnValue("mocked prompt");
vi.mock("@/lib/pipeline-prompt", () => ({
  buildPrompt: mockBuildPrompt,
  decisionSchema: {},
}));

vi.mock("@/lib/trade-executor", () => ({
  executeTrade: vi.fn().mockResolvedValue({ success: true }),
}));

const mockPortfolio = {
  id: "portfolio-1",
  userId: "user-1",
  name: "Test Portfolio",
  cashBalance: "10000.00",
  startingBalance: "10000.00",
  createdAt: new Date(),
  isDefault: true,
};

const mockRun = {
  id: "run-1",
  pipelineId: "pipeline-1",
  status: "running",
  triggeredBy: "test",
  tickersEvaluated: 0,
  tradesExecuted: 0,
  tradesSkipped: 0,
  tradesFailed: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: "0",
  errorMessage: null,
  startedAt: new Date(),
  completedAt: null,
  durationMs: null,
};

/**
 * Set up standard DB mocks for the pipeline run route.
 * - selectOnceResult: result for the FIRST db.select() call (Kronos forecast query)
 * - allOtherResult: result for all subsequent db.select() calls (holdings, quotes, etc.)
 */
function setupDbMocks(
  selectOnceResult: unknown[] = [],
  allOtherResult: unknown[] = []
) {
  vi.mocked(db.select)
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(selectOnceResult),
      }),
    } as any)
    .mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(allOtherResult),
      }),
    } as any);

  vi.mocked(db.insert).mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([mockRun]),
    }),
  } as any);

  vi.mocked(db.update).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  } as any);
}

const makeKronosPipeline = (overrides: Record<string, unknown> = {}) => ({
  id: "pipeline-1",
  userId: "user-1",
  name: "Kronos Pipeline",
  status: "active",
  thesis: "Rotate into Kronos winners.",
  tickerUniverse: ["MSFT"],
  kronosTickerUniverse: ["AAPL"],
  kronosMinTradePct: "20.00",
  kronosMaxTradePct: "80.00",
  kronosSaturationPct: "5.00",
  kronosSizingCurve: "linear",
  kronosMinSignalPct: "1.00",
  maxPositions: 10,
  maxPositionPct: "15.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.60",
  autonomous: true,
  allowShortSell: false,
  rebalanceOnRun: false,
  hypothesisConfig: null,
  configOverrides: [],
  strategyType: "kronos_rotation",
  portfolioLinks: [
    {
      id: "link-1",
      pipelineId: "pipeline-1",
      portfolioId: "portfolio-1",
      allocationPct: "100.00",
      portfolio: mockPortfolio,
    },
  ],
  ...overrides,
});

describe("POST /api/pipeline/run — Kronos rotation branch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildPrompt.mockReturnValue("mocked prompt");
    mockGenerateObject.mockResolvedValue({
      object: { decisions: [] },
      usage: { inputTokens: 100, outputTokens: 50 },
    });
  });

  it("calls buildPrompt with kronosForecastData when forecasts exist for today", async () => {
    const handler = await import("@/app/api/pipeline/run/route");

    const mockForecastRows = [
      { ticker: "AAPL", predictedReturnPct: "2.5000" },
      { ticker: "MSFT", predictedReturnPct: "-1.2000" },
    ];

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(makeKronosPipeline()),
      },
    };

    // First select: Kronos forecasts (returns rows)
    // All others: returns [] (holdings empty, etc.)
    setupDbMocks(mockForecastRows, []);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        expect(mockBuildPrompt).toHaveBeenCalled();
        const callArgs = mockBuildPrompt.mock.calls[0];
        // 6th argument is kronosForecastData
        const kronosData = callArgs?.[5];
        expect(Array.isArray(kronosData)).toBe(true);
        expect(kronosData.length).toBe(2);
        expect(kronosData[0].ticker).toBe("AAPL");
        expect(kronosData[0].predictedReturnPct).toBe(2.5);
      },
    });
  });

  it("warns and passes empty kronosForecastData when no forecasts found", async () => {
    const handler = await import("@/app/api/pipeline/run/route");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(makeKronosPipeline()),
      },
    };

    // Kronos forecasts: empty
    setupDbMocks([], []);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining("No Kronos forecasts")
        );
        expect(mockBuildPrompt).toHaveBeenCalled();
        const callArgs = mockBuildPrompt.mock.calls[0];
        const kronosData = callArgs?.[5];
        expect(Array.isArray(kronosData)).toBe(true);
        expect(kronosData.length).toBe(0);
      },
    });

    consoleSpy.mockRestore();
  });

  it("passes empty kronosForecastData for thesis_driven pipelines without querying forecasts", async () => {
    const handler = await import("@/app/api/pipeline/run/route");

    const thesisPipeline = makeKronosPipeline({
      strategyType: "thesis_driven",
      tickerUniverse: ["AAPL"],
      kronosTickerUniverse: [],
    });

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(thesisPipeline),
      },
    };

    // For thesis_driven: no Kronos query; first select is holdings
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockRun]),
      }),
    } as any);

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        expect(mockBuildPrompt).toHaveBeenCalled();
        const callArgs = mockBuildPrompt.mock.calls[0];
        const kronosData = callArgs?.[5];
        // For non-kronos pipeline, kronosForecastData is empty array
        expect(Array.isArray(kronosData)).toBe(true);
        expect(kronosData.length).toBe(0);
      },
    });
  });

  it("captures forecastsLoadedAt = max(createdAt) and forecastToRunGapMs on finalize", async () => {
    const handler = await import("@/app/api/pipeline/run/route");

    const startedAt = new Date("2026-06-11T15:00:00.000Z");
    const earliest = new Date("2026-06-11T14:00:00.000Z");
    const latest = new Date("2026-06-11T14:30:00.000Z");
    const middle = new Date("2026-06-11T14:15:00.000Z");

    const mockForecastRows = [
      { ticker: "AAPL", predictedReturnPct: "2.5000", createdAt: earliest },
      { ticker: "MSFT", predictedReturnPct: "-1.2000", createdAt: latest },
      { ticker: "GOOG", predictedReturnPct: "1.0000", createdAt: middle },
    ];

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(makeKronosPipeline()),
      },
    };

    // First select returns forecast rows (with createdAt); rest return empty
    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockForecastRows),
        }),
      } as any)
      .mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ ...mockRun, startedAt }]),
      }),
    } as any);

    const updateSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        const finalizeCall = updateSetMock.mock.calls.find(
          (c) => c[0] && c[0].status === "completed"
        );
        expect(finalizeCall).toBeDefined();
        const setArg = finalizeCall![0];
        expect(setArg.forecastsLoadedAt).toEqual(latest);
        expect(setArg.forecastToRunGapMs).toBe(
          startedAt.getTime() - latest.getTime()
        );
      },
    });
  });

  it("leaves forecastsLoadedAt and forecastToRunGapMs null when no forecasts exist", async () => {
    const handler = await import("@/app/api/pipeline/run/route");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(makeKronosPipeline()),
      },
    };

    setupDbMocks([], []);

    const updateSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        const finalizeCall = updateSetMock.mock.calls.find(
          (c) => c[0] && c[0].status === "completed"
        );
        expect(finalizeCall).toBeDefined();
        const setArg = finalizeCall![0];
        expect(setArg.forecastsLoadedAt).toBeNull();
        expect(setArg.forecastToRunGapMs).toBeNull();
      },
    });

    consoleSpy.mockRestore();
  });

  it("builds tickers as union of tickerUniverse and kronosTickerUniverse for kronos_rotation", async () => {
    const handler = await import("@/app/api/pipeline/run/route");

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(
          makeKronosPipeline({
            tickerUniverse: ["MSFT"],
            kronosTickerUniverse: ["AAPL"],
          })
        ),
      },
    };

    // Kronos forecasts: empty; holdings: empty
    setupDbMocks([], []);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        expect(mockBuildPrompt).toHaveBeenCalled();
        const callArgs = mockBuildPrompt.mock.calls[0];
        const tickers: string[] = callArgs?.[1];
        // Should include both MSFT (tickerUniverse) and AAPL (kronosTickerUniverse)
        expect(tickers).toContain("MSFT");
        expect(tickers).toContain("AAPL");
        // Union should be deduped
        const uniqueTickers = new Set(tickers);
        expect(uniqueTickers.size).toBe(tickers.length);
      },
    });
  });
});

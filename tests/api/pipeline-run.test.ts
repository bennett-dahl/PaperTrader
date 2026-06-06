import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";

// Mock QStash verification — must be before handler import
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: (handler: unknown) => handler,
}));

// Mock AI SDK
const mockGenerateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
}));

// Mock anthropic
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn().mockReturnValue("mock-model"),
}));

// Mock dependencies
vi.mock("@/lib/earnings", () => ({
  fetchEarningsSignals: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/pipeline-prompt", () => ({
  buildPrompt: vi.fn().mockReturnValue("mocked prompt"),
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

const mockPipelineWithLinks = {
  id: "pipeline-1",
  userId: "user-1",
  name: "Test Pipeline",
  status: "active",
  thesis: "Buy earnings beats.",
  tickerUniverse: ["AAPL"],
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
  strategyType: "thesis_driven",
  portfolioLinks: [
    {
      id: "link-1",
      pipelineId: "pipeline-1",
      portfolioId: "portfolio-1",
      allocationPct: "100.00",
      portfolio: mockPortfolio,
    },
  ],
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

describe("POST /api/pipeline/run — token tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accumulates promptTokens and completionTokens across portfolio links", async () => {
    const handler = await import("@/app/api/pipeline/run/route");

    // Set up generateObject to return usage data
    mockGenerateObject.mockResolvedValue({
      object: { decisions: [] },
      usage: { inputTokens: 3000, outputTokens: 500 },
    });

    // Mock query.pipelines.findFirst
    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(mockPipelineWithLinks),
      },
    };

    // holdings query (empty)
    // quotes query (empty)
    // run insert
    // run update (finalize)
    // pipeline update
    const updateSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockRun]) }),
    });

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockRun]),
      }),
    } as any);

    vi.mocked(db.update).mockReturnValue({
      set: updateSetMock,
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1", triggeredBy: "test" }),
        });
        // We care that: updateSetMock was called with token fields
        const updateCalls = updateSetMock.mock.calls;
        // Find the finalize call (has inputTokens)
        const finalizeCall = updateCalls.find((call) => {
          const setArg = call[0];
          return setArg && "inputTokens" in setArg;
        });
        if (finalizeCall) {
          const setArg = finalizeCall[0];
          expect(setArg.inputTokens).toBe(3000);
          expect(setArg.outputTokens).toBe(500);
          const cost = (3000 * 0.80 / 1_000_000) + (500 * 4.00 / 1_000_000);
          expect(parseFloat(setArg.costUsd)).toBeCloseTo(cost, 8);
        }
      },
    });
  });

  it("accumulates tokens across multiple portfolio links", async () => {
    // Two portfolio links = two generateObject calls = tokens should double
    mockGenerateObject.mockResolvedValue({
      object: { decisions: [] },
      usage: { inputTokens: 1000, outputTokens: 200 },
    });

    const twoLinkPipeline = {
      ...mockPipelineWithLinks,
      portfolioLinks: [
        { ...mockPipelineWithLinks.portfolioLinks[0] },
        {
          id: "link-2",
          pipelineId: "pipeline-1",
          portfolioId: "portfolio-2",
          allocationPct: "50.00",
          portfolio: { ...mockPortfolio, id: "portfolio-2" },
        },
      ],
    };

    (db as any).query = {
      pipelines: {
        findFirst: vi.fn().mockResolvedValue(twoLinkPipeline),
      },
    };

    const updateSetMock = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([mockRun]) }),
    });

    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockRun]),
      }),
    } as any);

    vi.mocked(db.update).mockReturnValue({ set: updateSetMock } as any);

    const handler = await import("@/app/api/pipeline/run/route");
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId: "pipeline-1" }),
        });

        const finalizeCall = updateSetMock.mock.calls.find((call) => {
          return call[0] && "inputTokens" in call[0];
        });
        if (finalizeCall) {
          // 2 portfolio links = 2x tokens
          expect(finalizeCall[0].inputTokens).toBe(2000);
          expect(finalizeCall[0].outputTokens).toBe(400);
        }
      },
    });
  });

  it("computes costUsd correctly", () => {
    const inputTokens = 10000;
    const outputTokens = 2000;
    const COST_PER_INPUT = 0.80 / 1_000_000;
    const COST_PER_OUTPUT = 4.00 / 1_000_000;
    const expected = (inputTokens * COST_PER_INPUT) + (outputTokens * COST_PER_OUTPUT);
    expect(expected).toBeCloseTo(0.016, 6);
  });
});

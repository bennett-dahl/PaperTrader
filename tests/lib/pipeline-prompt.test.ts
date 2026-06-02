import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/lib/pipeline-prompt";
import type { EarningsSignal } from "@/lib/earnings";

const pipelineConfig = {
  thesis: "Buy tech stocks that beat earnings.",
  strategyType: "thesis_driven",
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.65",
};

const portfolioState = {
  deployableCash: 5000,
  totalValue: 10000,
  holdings: [
    {
      ticker: "AAPL",
      shares: 10,
      avgCostBasis: 150,
      currentPrice: 175,
      marketValue: 1750,
    },
  ],
};

const earningsMap = new Map<string, EarningsSignal>([
  [
    "AAPL",
    {
      ticker: "AAPL",
      reportDate: "2025-02-01",
      reportTime: "amc",
      epsActual: 2.5,
      epsEstimate: 2.1,
      epsBeat: true,
      epsSurprisePct: 19.05,
      analystRevisionDirection: "up",
      revenueActual: 120000000000,
      revenueEstimate: 115000000000,
      revenueBeat: true,
    },
  ],
]);

describe("buildPrompt", () => {
  it("includes today's date", () => {
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, portfolioState, "2025-07-01");
    expect(prompt).toContain("2025-07-01");
  });

  it("includes the strategy thesis", () => {
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, portfolioState, "2025-07-01");
    expect(prompt).toContain("Buy tech stocks that beat earnings.");
  });

  it("includes earnings signal data", () => {
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, portfolioState, "2025-07-01");
    expect(prompt).toContain("AAPL:");
    expect(prompt).toContain("beat=true");
  });

  it("shows 'no earnings data' for tickers without signals", () => {
    const prompt = buildPrompt(pipelineConfig, ["GME"], new Map(), portfolioState, "2025-07-01");
    expect(prompt).toContain("GME: no earnings data in window");
  });

  it("includes portfolio cash and position limits", () => {
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, portfolioState, "2025-07-01");
    expect(prompt).toContain("$5000.00");
    expect(prompt).toContain("$10000.00");
  });

  it("includes holdings info", () => {
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, portfolioState, "2025-07-01");
    expect(prompt).toContain("AAPL: 10.00 shares");
  });

  it("shows 'None' for empty holdings", () => {
    const noHoldingsState = { ...portfolioState, holdings: [] };
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, noHoldingsState, "2025-07-01");
    expect(prompt).toContain("None");
  });

  it("includes confidence threshold instruction", () => {
    const prompt = buildPrompt(pipelineConfig, ["AAPL"], earningsMap, portfolioState, "2025-07-01");
    expect(prompt).toContain("0.65");
  });
});

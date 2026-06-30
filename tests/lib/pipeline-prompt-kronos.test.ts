import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/lib/pipeline-prompt";

const basePipeline = {
  thesis: "Rotate into Kronos predicted winners.",
  strategyType: "kronos_rotation",
  maxPositionPct: "15.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.60",
  kronosMinSignalPct: "1.00",
  kronosMinTradePct: "20.00",
  kronosMaxTradePct: "80.00",
  kronosSaturationPct: "5.00",
  kronosSizingCurve: "linear",
};

const portfolioState = {
  deployableCash: 8000,
  totalValue: 10000,
  holdings: [],
};

const emptyEarningsMap = new Map();

describe("buildPrompt — Kronos section", () => {
  it("includes Kronos AI Forecasts section when forecasts are provided", () => {
    const forecasts = [
      { ticker: "AAPL", predictedReturnPct: 2.5 },
      { ticker: "MSFT", predictedReturnPct: -1.2 },
    ];

    const prompt = buildPrompt(
      basePipeline,
      ["AAPL", "MSFT"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    expect(prompt).toContain("## Kronos AI Forecasts");
    expect(prompt).toContain("Ticker | Predicted Return");
  });

  it("does not include Kronos section when forecasts array is empty", () => {
    const prompt = buildPrompt(
      basePipeline,
      ["AAPL"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      []
    );

    expect(prompt).not.toContain("## Kronos AI Forecasts");
  });

  it("does not include Kronos section when forecasts parameter is omitted", () => {
    const prompt = buildPrompt(
      basePipeline,
      ["AAPL"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07"
    );

    expect(prompt).not.toContain("## Kronos AI Forecasts");
  });

  it("sorts forecasts descending by predictedReturnPct in the prompt", () => {
    const forecasts = [
      { ticker: "MSFT", predictedReturnPct: -1.2 },
      { ticker: "AAPL", predictedReturnPct: 2.5 },
      { ticker: "NVDA", predictedReturnPct: 1.8 },
    ];

    const prompt = buildPrompt(
      basePipeline,
      ["AAPL", "MSFT", "NVDA"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    // Search within the Kronos section only (tickers also appear in earnings)
    const kronosStart = prompt.indexOf("## Kronos AI Forecasts");
    expect(kronosStart).toBeGreaterThan(-1);
    const kronosSection = prompt.slice(kronosStart);

    // AAPL (2.5) should appear before NVDA (1.8), NVDA before MSFT (-1.2)
    const aaplIdx = kronosSection.indexOf("AAPL");
    const nvdaIdx = kronosSection.indexOf("NVDA");
    const msftIdx = kronosSection.indexOf("MSFT");
    expect(aaplIdx).toBeLessThan(nvdaIdx);
    expect(nvdaIdx).toBeLessThan(msftIdx);
  });

  it("formats positive predictedReturnPct with + prefix", () => {
    const forecasts = [{ ticker: "AAPL", predictedReturnPct: 2.5 }];

    const prompt = buildPrompt(
      basePipeline,
      ["AAPL"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    expect(prompt).toContain("+2.50%");
  });

  it("includes BUY rule for ticker with predicted return above threshold", () => {
    const forecasts = [{ ticker: "AAPL", predictedReturnPct: 2.5 }];

    const prompt = buildPrompt(
      { ...basePipeline, kronosMinSignalPct: "1.00" },
      ["AAPL"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    // Should mention BUY rule with the threshold
    expect(prompt).toContain("BUY candidates");
    expect(prompt).toContain("+1%");
  });

  it("includes SELL rule with trade size hint for ticker below negative threshold", () => {
    const forecasts = [{ ticker: "MSFT", predictedReturnPct: -1.5 }];

    const prompt = buildPrompt(
      { ...basePipeline, kronosMinSignalPct: "1.00" },
      ["MSFT"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    expect(prompt).toContain("SELL candidates");
    // signal=1.5%: linear t=(1.5-1)/(5-1)=0.125 → round(20+0.125*60)=round(27.5)=28%
    expect(prompt).toContain("→ trade 28%");
  });

  it("includes Kronos section before Instructions section", () => {
    const forecasts = [{ ticker: "AAPL", predictedReturnPct: 2.5 }];

    const prompt = buildPrompt(
      basePipeline,
      ["AAPL"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    const kronosIdx = prompt.indexOf("## Kronos AI Forecasts");
    const instructionsIdx = prompt.indexOf("## Instructions");
    expect(kronosIdx).toBeGreaterThan(-1);
    expect(instructionsIdx).toBeGreaterThan(-1);
    expect(kronosIdx).toBeLessThan(instructionsIdx);
  });

  it("includes sizing curve description and min/max trade sizes", () => {
    const forecasts = [{ ticker: "AAPL", predictedReturnPct: 2.5 }];

    const prompt = buildPrompt(
      basePipeline,
      ["AAPL"],
      emptyEarningsMap,
      portfolioState,
      "2026-06-07",
      forecasts
    );

    expect(prompt).toContain("sizing curve is linear");
    expect(prompt).toContain("20%");
    expect(prompt).toContain("80%");
  });
});

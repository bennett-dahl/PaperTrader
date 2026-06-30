import { describe, it, expect } from "vitest";
import { buildPrompt } from "@/lib/pipeline-prompt";
import type { EarningsSignal } from "@/lib/earnings";

const baseConfig = {
  thesis: "Kronos rotation strategy.",
  strategyType: "kronos_rotation",
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.65",
  kronosMinSignalPct: "1.00",
  kronosMinTradePct: "20.00",
  kronosMaxTradePct: "80.00",
  kronosSaturationPct: "5.00",
  kronosSizingCurve: "linear",
};

const portfolioState = {
  deployableCash: 5000,
  totalValue: 10000,
  holdings: [],
};

const earningsMap = new Map<string, EarningsSignal>();

describe("buildPrompt with Kronos sizing", () => {
  it("includes trade size hint for tickers above threshold", () => {
    const forecasts = [
      { ticker: "AAPL", predictedReturnPct: 3.0 },
      { ticker: "MSFT", predictedReturnPct: 5.0 },
    ];
    const prompt = buildPrompt(baseConfig, ["AAPL", "MSFT"], earningsMap, portfolioState, "2024-01-01", forecasts);
    
    // AAPL at 3% signal (linear: t=(3-1)/(5-1)=0.5 → 20+0.5*60=50%)
    expect(prompt).toContain("→ trade 50%");
    // MSFT at 5% = saturation → max trade 80%
    expect(prompt).toContain("→ trade 80%");
  });

  it("shows 'below threshold' for tickers at 0.5% signal", () => {
    const forecasts = [
      { ticker: "GOOG", predictedReturnPct: 0.5 },
    ];
    const prompt = buildPrompt(baseConfig, ["GOOG"], earningsMap, portfolioState, "2024-01-01", forecasts);
    expect(prompt).toContain("→ below threshold");
  });

  it("includes sizing curve description in prompt", () => {
    const forecasts = [{ ticker: "AAPL", predictedReturnPct: 2.0 }];
    const prompt = buildPrompt(baseConfig, ["AAPL"], earningsMap, portfolioState, "2024-01-01", forecasts);
    expect(prompt).toContain("sizing curve is linear");
    expect(prompt).toContain("20%");
    expect(prompt).toContain("80%");
  });

  it("uses log curve sizing when configured", () => {
    const logConfig = { ...baseConfig, kronosSizingCurve: "log" };
    const forecasts = [{ ticker: "AAPL", predictedReturnPct: 2.0 }];
    const prompt = buildPrompt(logConfig, ["AAPL"], earningsMap, portfolioState, "2024-01-01", forecasts);
    // With log curve, at signal=2: t_raw=(2-1)/(5-1)=0.25; t=log1p(9*0.25)/log(10)=log1p(2.25)/log(10)≈0.524
    // size = round(20 + 0.524*(80-20)) = round(51.4) = 51
    expect(prompt).toContain("→ trade 51%");
    expect(prompt).toContain("sizing curve is log");
  });

  it("handles missing kronosForecasts gracefully", () => {
    const prompt = buildPrompt(baseConfig, ["AAPL"], earningsMap, portfolioState, "2024-01-01");
    expect(prompt).not.toContain("Kronos AI Forecasts");
  });

  it("handles empty kronosForecasts gracefully", () => {
    const prompt = buildPrompt(baseConfig, ["AAPL"], earningsMap, portfolioState, "2024-01-01", []);
    expect(prompt).not.toContain("Kronos AI Forecasts");
  });
});

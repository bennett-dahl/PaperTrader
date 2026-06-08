import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  KronosForecastsCard,
  deriveSignal,
  type KronosForecastRow,
} from "@/components/KronosForecastsCard";

describe("deriveSignal", () => {
  it("returns 'buy' when predictedReturnPct > kronosMinSignalPct", () => {
    expect(deriveSignal(2.5, 1.0)).toBe("buy");
  });

  it("returns 'sell' when predictedReturnPct < -kronosMinSignalPct", () => {
    expect(deriveSignal(-2.0, 1.0)).toBe("sell");
  });

  it("returns 'hold' when predictedReturnPct is within ±kronosMinSignalPct", () => {
    expect(deriveSignal(0.5, 1.0)).toBe("hold");
    expect(deriveSignal(-0.5, 1.0)).toBe("hold");
    expect(deriveSignal(0, 1.0)).toBe("hold");
  });

  it("returns 'hold' when predictedReturnPct equals exactly the threshold", () => {
    // Boundary: equal to threshold is NOT > threshold, so should be hold
    expect(deriveSignal(1.0, 1.0)).toBe("hold");
    expect(deriveSignal(-1.0, 1.0)).toBe("hold");
  });
});

describe("KronosForecastsCard — empty state", () => {
  it("renders 'No Kronos forecasts for this run.' when forecasts is empty", () => {
    render(<KronosForecastsCard forecasts={[]} kronosMinSignalPct={1.0} />);
    expect(
      screen.getByText("No Kronos forecasts for this run.")
    ).toBeInTheDocument();
  });

  it("renders the card title 'Kronos Forecasts' in empty state", () => {
    render(<KronosForecastsCard forecasts={[]} kronosMinSignalPct={1.0} />);
    expect(screen.getByText("Kronos Forecasts")).toBeInTheDocument();
  });
});

describe("KronosForecastsCard — with forecasts", () => {
  const forecasts: KronosForecastRow[] = [
    { ticker: "AAPL", predictedReturnPct: 2.5, signal: "buy" },
    { ticker: "MSFT", predictedReturnPct: -1.5, signal: "sell" },
    { ticker: "NVDA", predictedReturnPct: 0.5, signal: "hold" },
  ];

  it("renders all tickers in the table", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
  });

  it("renders +2.50% for AAPL (positive return)", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
  });

  it("renders -1.50% for MSFT (negative return)", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("-1.50%")).toBeInTheDocument();
  });

  it("renders 🟢 Buy signal for buy forecasts", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("🟢 Buy")).toBeInTheDocument();
  });

  it("renders 🔴 Sell signal for sell forecasts", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("🔴 Sell")).toBeInTheDocument();
  });

  it("renders ⚪ Hold signal for hold forecasts", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("⚪ Hold")).toBeInTheDocument();
  });

  it("renders the threshold in the card description", () => {
    render(
      <KronosForecastsCard forecasts={forecasts} kronosMinSignalPct={1.5} />
    );
    expect(screen.getByText(/±1\.5%/)).toBeInTheDocument();
  });

  it("renders ⚪ Hold when predictedReturnPct = 0.5 and kronosMinSignalPct = 1.0", () => {
    const holdForecasts: KronosForecastRow[] = [
      { ticker: "TSLA", predictedReturnPct: 0.5, signal: "hold" },
    ];
    render(
      <KronosForecastsCard forecasts={holdForecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("⚪ Hold")).toBeInTheDocument();
  });

  it("renders 🔴 Sell when predictedReturnPct = -2.0 and kronosMinSignalPct = 1.0", () => {
    const sellForecasts: KronosForecastRow[] = [
      { ticker: "PLTR", predictedReturnPct: -2.0, signal: "sell" },
    ];
    render(
      <KronosForecastsCard forecasts={sellForecasts} kronosMinSignalPct={1.0} />
    );
    expect(screen.getByText("🔴 Sell")).toBeInTheDocument();
  });
});

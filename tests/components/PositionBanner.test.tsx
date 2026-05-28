import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import PositionBanner from "@/components/PositionBanner";

describe("PositionBanner", () => {
  it("renders total portfolio value = cashBalance + holdingsValue", () => {
    render(<PositionBanner cashBalance={3000} startingBalance={5000} holdingsValue={2500} />);
    // totalValue = 3000 + 2500 = 5500
    expect(screen.getByText(/5,500\.00/)).toBeInTheDocument();
  });

  it("renders positive P&L in green when above startingBalance", () => {
    render(<PositionBanner cashBalance={3000} startingBalance={5000} holdingsValue={2500} />);
    // pnl = 5500 - 5000 = +500
    const pnlEl = screen.getByText(/\+\$500\.00 all time/);
    expect(pnlEl).toBeInTheDocument();
    expect(pnlEl.className).toMatch(/emerald/);
  });

  it("renders negative P&L in red when below startingBalance", () => {
    render(<PositionBanner cashBalance={1000} startingBalance={5000} holdingsValue={1000} />);
    // totalValue = 2000, pnl = -3000
    const pnlEl = screen.getByText(/-\$3,000\.00 all time/);
    expect(pnlEl).toBeInTheDocument();
    expect(pnlEl.className).toMatch(/red/);
  });

  it("renders 0 P&L correctly when value equals starting balance", () => {
    render(<PositionBanner cashBalance={2500} startingBalance={5000} holdingsValue={2500} />);
    // totalValue = 5000, pnl = 0
    expect(screen.getByText(/\+\$0\.00 all time/)).toBeInTheDocument();
  });

  it("renders P&L percentage", () => {
    render(<PositionBanner cashBalance={3000} startingBalance={5000} holdingsValue={2500} />);
    // pnl = 500/5000 * 100 = 10%
    expect(screen.getByText(/10\.00%/)).toBeInTheDocument();
  });

  it("formats currency values with 2 decimal places", () => {
    render(<PositionBanner cashBalance={3000.5} startingBalance={5000} holdingsValue={1999.5} />);
    // cashBalance should be shown as $3,000.50
    expect(screen.getByText(/3,000\.50/)).toBeInTheDocument();
  });
});

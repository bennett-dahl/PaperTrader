import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import HoldingRow from "@/components/HoldingRow";

// Mock StockDetailSheet
vi.mock("@/components/stock-detail/StockDetailSheet", () => ({
  StockDetailSheet: ({ open, ticker }: { open: boolean; ticker: string }) =>
    open ? <div data-testid="stock-detail-sheet">{ticker}</div> : null,
}));

// Mock ActivePortfolioContext
vi.mock("@/contexts/ActivePortfolioContext", () => ({
  useActivePortfolio: () => ({ activePortfolioId: "portfolio-uuid-1" }),
}));

const defaultProps = {
  ticker: "AAPL",
  shares: 10,
  avgCostBasis: 150,
  portfolioId: "portfolio-uuid-1",
};

describe("HoldingRow", () => {
  it("renders ticker", () => {
    render(<HoldingRow {...defaultProps} />);
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("renders company name when provided", () => {
    render(<HoldingRow {...defaultProps} name="Apple Inc." />);
    expect(screen.getByText("Apple Inc.")).toBeInTheDocument();
  });

  it("renders current value = shares * currentPrice", () => {
    render(<HoldingRow {...defaultProps} currentPrice={175} />);
    // 10 * 175 = 1750
    expect(screen.getByText(/1,750\.00/)).toBeInTheDocument();
  });

  it("falls back to avgCostBasis for value when currentPrice not provided", () => {
    render(<HoldingRow {...defaultProps} />);
    // 10 * 150 = 1500
    expect(screen.getByText(/1,500\.00/)).toBeInTheDocument();
  });

  it("shows positive gain/loss in green with + prefix", () => {
    render(<HoldingRow {...defaultProps} currentPrice={200} />);
    // gain = 10*(200-150) = 500
    const gainEl = screen.getByText(/\+\$500\.00/);
    expect(gainEl).toBeInTheDocument();
    expect(gainEl.className).toMatch(/emerald/);
  });

  it("shows negative gain/loss in red", () => {
    render(<HoldingRow {...defaultProps} currentPrice={100} />);
    // loss = 10*(100-150) = -500
    const lossEl = screen.getByText(/\$500\.00/);
    expect(lossEl).toBeInTheDocument();
    expect(lossEl.className).toMatch(/red/);
  });

  it("shows integer share count for whole-share holdings", () => {
    render(<HoldingRow {...defaultProps} shares={5} />);
    expect(screen.getByText(/5 shares/)).toBeInTheDocument();
  });

  it("shows 4-decimal share count for fractional holdings", () => {
    render(<HoldingRow {...defaultProps} shares={2.5} />);
    expect(screen.getByText(/2\.5000 shares/)).toBeInTheDocument();
  });

  it("opens StockDetailSheet on click", () => {
    render(<HoldingRow {...defaultProps} />);
    expect(screen.queryByTestId("stock-detail-sheet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("AAPL").closest("div")!.parentElement!);
    expect(screen.getByTestId("stock-detail-sheet")).toBeInTheDocument();
  });
});

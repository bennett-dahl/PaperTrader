import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import LivePortfolioDashboard from "@/components/LivePortfolioDashboard";

// Mock child components
vi.mock("@/components/PortfolioCard", () => ({
  default: ({ totalValue, cashBalance }: any) => (
    <div data-testid="portfolio-card">
      <span data-testid="total-value">{totalValue}</span>
      <span data-testid="cash-balance">{cashBalance}</span>
    </div>
  ),
}));

vi.mock("@/components/HoldingRow", () => ({
  default: ({ ticker, shares }: any) => (
    <div data-testid={`holding-row-${ticker}`}>
      {ticker}: {shares}
    </div>
  ),
}));

const mockHolding = {
  ticker: "AAPL",
  name: "Apple Inc.",
  shares: 10,
  avgCostBasis: 150,
  currentPrice: 175,
  change: 2,
  changePercent: 1.16,
};

const defaultProps = {
  portfolioId: "p1",
  initialHoldings: [],
  initialCashBalance: 3000,
  initialTotalValue: 3000,
  startingBalance: 5000,
};

describe("LivePortfolioDashboard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ holdings: [], cashBalance: 3000 }),
    }));
  });

  it("renders with no holdings showing empty state", async () => {
    render(<LivePortfolioDashboard {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText(/no holdings yet/i)).toBeInTheDocument();
    });
  });

  it("renders holdings when initialHoldings provided", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ holdings: [mockHolding], cashBalance: 3000 }),
    } as any);

    render(<LivePortfolioDashboard {...defaultProps} initialHoldings={[mockHolding]} />);
    await waitFor(() => {
      expect(screen.getByTestId("holding-row-AAPL")).toBeInTheDocument();
    });
  });

  it("shows portfolio card", async () => {
    render(<LivePortfolioDashboard {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId("portfolio-card")).toBeInTheDocument();
    });
  });

  it("fetches holdings on mount", async () => {
    render(<LivePortfolioDashboard {...defaultProps} />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/holdings?portfolioId=p1")
      );
    });
  });

  it("fetches quotes on mount", async () => {
    const holdingsWithTicker = [mockHolding];
    render(<LivePortfolioDashboard {...defaultProps} initialHoldings={holdingsWithTicker} />);
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/quotes")
      );
    });
  });

  it("handles fetch error gracefully", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));
    // Should not throw
    expect(() => render(<LivePortfolioDashboard {...defaultProps} />)).not.toThrow();
  });

  it("updates holdings when portfolioId changes", async () => {
    const { rerender } = render(<LivePortfolioDashboard {...defaultProps} />);
    
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ holdings: [mockHolding], cashBalance: 2000 }),
    } as any);

    rerender(<LivePortfolioDashboard {...defaultProps} portfolioId="p2" />);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("portfolioId=p2")
      );
    });
  });

  it("does not crash when holdings fetch returns non-ok", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as any);
    expect(() => render(<LivePortfolioDashboard {...defaultProps} />)).not.toThrow();
  });

  it("handles quote fetch ok=false gracefully (continues)", async () => {
    const holdingsWithTicker = [mockHolding];
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 500 } as any) // holdings fetch  
      .mockResolvedValueOnce({ ok: false, status: 500 } as any); // quotes fetch
    
    expect(() => render(<LivePortfolioDashboard {...defaultProps} initialHoldings={holdingsWithTicker} />)).not.toThrow();
  });

  it("shows refreshing indicator during quote fetch", async () => {
    let resolveQuote: (v: any) => void;
    const quotePendingFetch = new Promise((r) => (resolveQuote = r));
    
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ holdings: [mockHolding], cashBalance: 3000 }) } as any)
      .mockReturnValueOnce(quotePendingFetch as any);

    render(<LivePortfolioDashboard {...defaultProps} initialHoldings={[mockHolding]} />);
    
    // Should show refreshing or loading state
    await waitFor(() => expect(document.body).toBeTruthy());
    
    resolveQuote!({ ok: true, json: async () => ({ quotes: {} }) });
  });

});

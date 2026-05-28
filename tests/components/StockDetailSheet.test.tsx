import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDetailSheet } from "@/components/stock-detail/StockDetailSheet";

// Mock hooks used by StockDetailSheet
vi.mock("@/hooks/useWatchlist", () => ({
  useWatchlist: () => ({
    status: "not_watching",
    isToggling: false,
    toggle: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSwipeToDismiss", () => ({
  useSwipeToDismiss: () => ({
    dragY: 0,
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
  }),
}));

vi.mock("@/contexts/ActivePortfolioContext", () => ({
  useActivePortfolio: () => ({ activePortfolioId: "p1" }),
}));

// Mock PriceChart to avoid recharts issues
vi.mock("@/components/PriceChart", () => ({
  default: () => <div data-testid="price-chart" />,
}));

describe("StockDetailSheet", () => {
  it("renders ticker in header when open=true", () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
        stockName="Apple Inc."
      />
    );
    // Ticker should be visible in the header when open
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("fetches stock detail on open", () => {
    const mockFetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", mockFetch);

    render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
        stockName="Apple Inc."
      />
    );

    expect(mockFetch).toHaveBeenCalled();
  });

  it("renders timeframe selector tabs when open and data loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ticker: "AAPL",
        profile: { name: "Apple Inc." },
        quote: { currentPrice: 175, change: 2, changePercent: 1.2, timestamp: Date.now() },
        fundamentals: null,
        fetchedAt: Date.now(),
      }),
    }));

    render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
      />
    );

    // Wait for data to load and tabs to appear
    await waitFor(() => {
      const timeframes = ["1D", "1W", "1M", "3M", "1Y"];
      const found = timeframes.some((tf) => screen.queryByText(tf));
      expect(found).toBe(true);
    }, { timeout: 3000 });
  });
});

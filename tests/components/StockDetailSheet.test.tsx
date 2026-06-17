import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDetailSheet } from "@/components/stock-detail/StockDetailSheet";
import { TransactionRow } from "@/types/transactions";

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

describe("StockDetailSheet — Kronos forecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Kronos Forecast row with +2.30% in green when forecast available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/forecast")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              predictedReturnPct: 2.3,
              forecastDate: "2026-06-07",
            }),
          });
        }
        // All other fetches (detail, candles) return pending so they don't race
        return new Promise(() => {});
      })
    );

    render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
        stockName="Apple Inc."
        context="search"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Kronos Forecast")).toBeInTheDocument();
    }, { timeout: 3000 });

    expect(screen.getByText("+2.30%")).toBeInTheDocument();
  });

  it("does not render Kronos Forecast row when API returns null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/forecast")) {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          });
        }
        return new Promise(() => {});
      })
    );

    render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
        stockName="Apple Inc."
        context="search"
      />
    );

    // Give async effects time to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.queryByText("Kronos Forecast")).not.toBeInTheDocument();
  });

  it("does not render Kronos Forecast row when fetch throws network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/forecast")) {
          return Promise.reject(new Error("Network error"));
        }
        return new Promise(() => {});
      })
    );

    render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
        stockName="Apple Inc."
        context="search"
      />
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(screen.queryByText("Kronos Forecast")).not.toBeInTheDocument();
  });
});

describe("StockDetailSheet — Your trades section", () => {
  const mockTrades: TransactionRow[] = [
    {
      id: "t1",
      ticker: "AAPL",
      type: "BUY",
      shares: "10.000000",
      pricePerShare: "150.0000",
      totalAmount: "1500.00",
      costBasisAtSale: null,
      executedAt: new Date("2026-06-01T10:00:00Z"),
      pipelineId: null,
      pipelineName: null,
    },
    {
      id: "t2",
      ticker: "AAPL",
      type: "SELL",
      shares: "5.000000",
      pricePerShare: "200.0000",
      totalAmount: "1000.00",
      costBasisAtSale: "150.0000",
      executedAt: new Date("2026-06-10T14:00:00Z"),
      pipelineId: null,
      pipelineName: null,
    },
  ];

  function setupFetch(trades: TransactionRow[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: RequestInfo | URL) => {
        const urlStr = url.toString();
        if (urlStr.includes("/transactions")) {
          return Promise.resolve({ ok: true, json: async () => trades } as any);
        }
        return Promise.resolve({ ok: false, json: async () => ({}) } as any);
      })
    );
  }

  function renderSheet() {
    return render(
      <StockDetailSheet
        open={true}
        onClose={vi.fn()}
        ticker="AAPL"
        stockName="Apple Inc."
        context="holdings"
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Your trades' heading when open", async () => {
    setupFetch(mockTrades);
    renderSheet();
    await waitFor(() => {
      expect(screen.getByText("Your trades")).toBeInTheDocument();
    });
  });

  it("shows 'No trades for this stock yet' when trades array is empty", async () => {
    setupFetch([]);
    renderSheet();
    await waitFor(() => {
      expect(screen.getByText(/no trades for this stock yet/i)).toBeInTheDocument();
    });
  });

  it("calculates P&L for SELL: (200 - 150) * 5 = +$250.00", async () => {
    setupFetch(mockTrades);
    renderSheet();
    await waitFor(() => {
      expect(screen.getByText("+$250.00")).toBeInTheDocument();
    });
    const pnlEl = screen.getByText("+$250.00");
    expect(pnlEl.className).toMatch(/emerald/);
  });

  it("does not render P&L for BUY rows", async () => {
    setupFetch([mockTrades[0]]); // BUY only
    renderSheet();
    await waitFor(() => {
      expect(screen.getByText("BUY")).toBeInTheDocument();
    });
    expect(screen.queryByText(/\+\$/)).not.toBeInTheDocument();
  });

  it("does not render P&L when costBasisAtSale is null on SELL", async () => {
    const sellNoCost: TransactionRow[] = [
      { ...mockTrades[1], costBasisAtSale: null },
    ];
    setupFetch(sellNoCost);
    renderSheet();
    await waitFor(() => {
      expect(screen.getByText("SELL")).toBeInTheDocument();
    });
    expect(screen.queryByText(/\+\$|-\$/)).not.toBeInTheDocument();
  });

  it("shows P&L in red for a losing SELL", async () => {
    const losingTrades: TransactionRow[] = [
      {
        ...mockTrades[1],
        pricePerShare: "100.0000",    // sold at $100
        costBasisAtSale: "150.0000",  // bought at $150 → loss
        totalAmount: "500.00",
        shares: "5.000000",
      },
    ];
    setupFetch(losingTrades);
    renderSheet();
    // P&L = (100 - 150) * 5 = -$250.00
    await waitFor(() => {
      const pnlEl = screen.getByText("-$250.00");
      expect(pnlEl).toBeInTheDocument();
      expect(pnlEl.className).toMatch(/red/);
    });
  });
});

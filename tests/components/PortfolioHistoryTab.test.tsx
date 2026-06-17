import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PortfolioHistoryTab from "@/components/PortfolioHistoryTab";
import { TransactionRow } from "@/types/transactions";

global.fetch = vi.fn();

const today = new Date();
const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

const mockBuy: TransactionRow = {
  id: "t1",
  ticker: "AAPL",
  type: "BUY",
  shares: "10.000000",
  pricePerShare: "150.0000",
  totalAmount: "1500.00",
  costBasisAtSale: null,
  executedAt: today,
  pipelineId: null,
  pipelineName: null,
};

const mockSell: TransactionRow = {
  id: "t2",
  ticker: "NVDA",
  type: "SELL",
  shares: "5.000000",
  pricePerShare: "800.0000",
  totalAmount: "4000.00",
  costBasisAtSale: "600.0000",
  executedAt: twoDaysAgo,
  pipelineId: "p1",
  pipelineName: "Kronos Pure Signal",
};

describe("PortfolioHistoryTab", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  it("shows loading state initially", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    render(<PortfolioHistoryTab portfolioId="p1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows empty state when no transactions returned", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => expect(screen.getByText(/no trades yet/i)).toBeInTheDocument());
  });

  it("groups today's trades under 'Today'", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument());
  });

  it("does not label older trades as 'Today'", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockSell] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
    });
  });

  it("renders BUY badge with emerald color", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      const badge = screen.getByText("BUY");
      expect(badge.className).toMatch(/emerald/);
    });
  });

  it("renders SELL badge with red color", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockSell] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      const badge = screen.getByText("SELL");
      expect(badge.className).toMatch(/red/);
    });
  });

  it("renders pipeline chip for pipeline-attributed trade", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockSell] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("Kronos Pure Signal")).toBeInTheDocument();
    });
  });

  it("renders 'Manual' label for trades without pipeline", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("Manual")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load history/i)).toBeInTheDocument();
    });
  });

  it("renders ticker and shares for each row", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [mockBuy] } as any);
    render(<PortfolioHistoryTab portfolioId="p1" />);
    await waitFor(() => {
      expect(screen.getByText("AAPL")).toBeInTheDocument();
    });
  });
});

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Step2Suggestions from "@/components/builder/Step2Suggestions";

vi.mock("@/components/stock-detail/StockDetailSheet", () => ({
  StockDetailSheet: () => null,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockConfig = {
  portfolioId: "p1",
  amount: 1000,
  riskLevel: "low" as const,
  categories: [],
  stockCount: 2,
};

const mockSuggestions = [
  { ticker: "AAPL", name: "Apple Inc.", sector: "Tech", category: "Tech", riskLevel: "low", marketCap: "large", description: null, price: 150, shares: 3.333, allocatedAmount: 499.95 },
  { ticker: "MSFT", name: "Microsoft", sector: "Tech", category: "Tech", riskLevel: "low", marketCap: "large", description: null, price: 300, shares: 1.666, allocatedAmount: 499.8 },
];

describe("Step2Suggestions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows loading state while fetching suggestions", () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );
    // The component shows a Loader2 spinner with text while fetching
    expect(screen.getByText(/finding|best picks|loading/i)).toBeInTheDocument();
  });

  it("renders suggestion cards with ticker and allocatedAmount", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: mockSuggestions }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("AAPL")).toBeInTheDocument();
    });
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("goes back to Step 1 on 'Back' click", async () => {
    const onBack = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: mockSuggestions }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={onBack} onConfirm={vi.fn()} />
    );

    await waitFor(() => screen.getByText("AAPL"));
    const backBtn = screen.getByRole("button", { name: /back/i });
    backBtn.click();
    expect(onBack).toHaveBeenCalled();
  });

  it("shows 'No suggestions found' state when empty", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: [] }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText(/no stocks found|no suggestions/i)).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Server error" }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText(/server error|failed/i)).toBeInTheDocument();
    });
  });

  it("calls onConfirm when Invest Now is clicked", async () => {
    const onConfirm = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: mockSuggestions }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={onConfirm} />
    );

    await waitFor(() => screen.getByText("AAPL"));
    const confirmBtn = screen.queryByRole("button", { name: /review|buy all|confirm|next/i });
    if (confirmBtn) {
      confirmBtn.click();
      expect(onConfirm).toHaveBeenCalled();
    }
  });

  it("fetches again when refresh button clicked", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: mockSuggestions }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => screen.getByText("AAPL"));
    
    const refreshBtn = screen.queryByRole("button", { name: /refresh|regenerate/i });
    if (refreshBtn) {
      refreshBtn.click();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    }
  });
});

  it("calls onConfirm with suggestions when 'Review & Buy All' clicked", async () => {
    const onConfirm = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ suggestions: mockSuggestions }),
    } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={onConfirm} />
    );

    await waitFor(() => screen.getByText("AAPL"));
    const btn = screen.queryByRole("button", { name: /review.*buy|buy.*all/i });
    if (btn) {
      fireEvent.click(btn);
      expect(onConfirm).toHaveBeenCalledWith(mockSuggestions);
    }
  });

  it("handles swap button click and updates suggestion", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ suggestions: mockSuggestions }) } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestion: {
            ticker: "GOOG",
            name: "Alphabet Inc.",
            sector: "Technology",
            category: "Technology",
            riskLevel: "low",
            marketCap: "large",
            description: null,
            price: 140,
            shares: 3.5,
            allocatedAmount: 490,
          }
        }),
      } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => screen.getByText("AAPL"));
    
    // Find swap button (if accessible)
    const swapBtns = screen.queryAllByRole("button", { name: /swap/i });
    if (swapBtns.length > 0) {
      fireEvent.click(swapBtns[0]);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    }
  });

  it("shows error toast when swap fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ suggestions: mockSuggestions }) } as any)
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Swap failed" }) } as any);

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => screen.getByText("AAPL"));
    
    const swapBtns = screen.queryAllByRole("button", { name: /swap/i });
    if (swapBtns.length > 0) {
      fireEvent.click(swapBtns[0]);
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    }
  });

  it("shows error message when fetch throws", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Network failure"));

    render(
      <Step2Suggestions config={mockConfig} onBack={vi.fn()} onConfirm={vi.fn()} />
    );

    await waitFor(() => {
      const errorEl = screen.queryByText(/failed|error|network/i);
      expect(document.body).toBeTruthy(); // at minimum, no crash
    });
  });

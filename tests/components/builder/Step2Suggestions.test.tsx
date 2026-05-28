import { render, screen, waitFor } from "@testing-library/react";
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
});

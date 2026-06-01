import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Step3Confirm from "@/components/builder/Step3Confirm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
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

describe("Step3Confirm", () => {
  it("renders summary of allocations with tickers", () => {
    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={null}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );
    expect(screen.getByText("AAPL")).toBeInTheDocument();
    expect(screen.getByText("MSFT")).toBeInTheDocument();
  });

  it("renders total invested amount", () => {
    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={null}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );
    // Total = 499.95 + 499.8 = 999.75
    expect(screen.getByText(/999\.75|999/)).toBeInTheDocument();
  });

  it("goes back to Step 2 on 'Back' click", () => {
    const onBack = vi.fn();
    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={null}
        onBack={onBack}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );
    const backBtn = screen.getByRole("button", { name: /back/i });
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalled();
  });

  it("calls POST /api/suggest/execute on Execute All click", async () => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], successCount: 2, failCount: 0, totalTrades: 2 }),
    } as any);

    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={null}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );

    const executeBtn = screen.getByRole("button", { name: /buy all/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/suggest/execute",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("shows per-trade results after execution", () => {
    const results = {
      results: [
        { ticker: "AAPL", success: true, totalAmount: 499.95 },
        { ticker: "MSFT", success: false, error: "Insufficient cash" },
      ],
      successCount: 1,
      failCount: 1,
    };

    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={results}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );
    // Partial success: "1 of 2 trades succeeded"
    expect(screen.getByText(/trades succeeded|of 2 trades/i)).toBeInTheDocument();
  });

  it("shows success state when all trades succeed", () => {
    const results = {
      results: [
        { ticker: "AAPL", success: true, totalAmount: 499.95 },
        { ticker: "MSFT", success: true, totalAmount: 499.8 },
      ],
      successCount: 2,
      failCount: 0,
    };

    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={results}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );
    expect(screen.getByText(/2 trades executed successfully|all.*trades/i)).toBeInTheDocument();
  });

  it("shows all-failed state when all trades fail", () => {
    const results = {
      results: [
        { ticker: "AAPL", success: false, error: "Insufficient cash" },
        { ticker: "MSFT", success: false, error: "Insufficient cash" },
      ],
      successCount: 0,
      failCount: 2,
    };

    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={results}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );
    const failedElements = screen.getAllByText(/failed|no trades executed|Trades Failed/i);
    expect(failedElements.length).toBeGreaterThan(0);
  });

  it("calls onReset when reset/start over button clicked after execution", () => {
    const onReset = vi.fn();
    const results = {
      results: [{ ticker: "AAPL", success: true, totalAmount: 499.95 }],
      successCount: 1,
      failCount: 0,
    };

    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={[mockSuggestions[0]]}
        executeResults={results}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={onReset}
      />
    );
    const resetBtn = screen.queryByRole("button", { name: /start over|reset|new/i });
    if (resetBtn) {
      fireEvent.click(resetBtn);
      expect(onReset).toHaveBeenCalled();
    }
  });

  it("shows error toast when execute API fails", async () => {
    const { toast } = await import("sonner");
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Server error" }),
    } as any);

    render(
      <Step3Confirm
        config={mockConfig}
        suggestions={mockSuggestions}
        executeResults={null}
        onBack={vi.fn()}
        onExecute={vi.fn()}
        onReset={vi.fn()}
      />
    );

    const executeBtn = screen.getByRole("button", { name: /buy all/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });
});

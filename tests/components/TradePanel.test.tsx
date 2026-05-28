import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import TradePanel from "@/components/TradePanel";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const defaultProps = {
  ticker: "AAPL",
  portfolioId: "portfolio-uuid-1",
  quote: { price: 150.0, changePercent: 1.5 },
  quoteLoading: false,
};

describe("TradePanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders BUY tab selected by default", () => {
    render(<TradePanel {...defaultProps} />);
    const buyTab = screen.getByText("Buy");
    expect(buyTab).toBeInTheDocument();
  });

  it("renders SELL tab", () => {
    render(<TradePanel {...defaultProps} />);
    expect(screen.getByText("Sell")).toBeInTheDocument();
  });

  it("shows stock price from quote prop", () => {
    render(<TradePanel {...defaultProps} />);
    expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
  });

  it("shows loading message when quoteLoading=true", () => {
    render(<TradePanel {...defaultProps} quote={null} quoteLoading={true} />);
    expect(screen.getByText(/loading price/i)).toBeInTheDocument();
  });

  it("computes and displays total cost = quote.price * shares", () => {
    render(<TradePanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("0");
    fireEvent.change(input, { target: { value: "2" } });
    expect(screen.getByText(/300\.00/)).toBeInTheDocument();
  });

  it("disables submit button when shares input is empty", () => {
    render(<TradePanel {...defaultProps} />);
    const button = screen.getByRole("button", { name: /buy aapl/i });
    expect(button).toBeDisabled();
  });

  it("disables submit button when quoteLoading=true", () => {
    render(<TradePanel {...defaultProps} quoteLoading={true} quote={null} />);
    const button = screen.getByRole("button", { name: /buy aapl/i });
    expect(button).toBeDisabled();
  });

  it("calls POST /api/trade with correct body on submit", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        trade: { pricePerShare: 150, ticker: "AAPL", shares: 1, type: "BUY", totalAmount: 150 },
      }),
    } as any);

    render(<TradePanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("0");
    fireEvent.change(input, { target: { value: "1" } });

    const button = screen.getByRole("button", { name: /buy aapl/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/trade",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"ticker":"AAPL"'),
        })
      );
    });
  });

  it("calls onSuccess callback after successful trade", async () => {
    const onSuccess = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        trade: { pricePerShare: 150, ticker: "AAPL", shares: 1, type: "BUY", totalAmount: 150 },
      }),
    } as any);

    render(<TradePanel {...defaultProps} onSuccess={onSuccess} />);
    const input = screen.getByPlaceholderText("0");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /buy aapl/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("shows error toast when trade API returns error message", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Insufficient cash" }),
    } as any);

    render(<TradePanel {...defaultProps} />);
    const input = screen.getByPlaceholderText("0");
    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /buy aapl/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Insufficient cash"));
  });
});

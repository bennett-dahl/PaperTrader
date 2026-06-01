import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PortfolioActions from "@/components/PortfolioActions";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
}));

// Mock Button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className, variant, size }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

// Mock Input
vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, onKeyDown, placeholder, type, min, step, className }: any) => (
    <input
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      type={type}
      min={min}
      step={step}
      className={className}
    />
  ),
}));

// Mock Dialog
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

const defaultProps = {
  portfolioId: "portfolio-uuid-1",
  portfolioName: "My Portfolio",
  cashBalance: 3000,
  holdingsCount: 0,
  isDefault: false,
};

describe("PortfolioActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  it("renders Rename, Add Cash, and Delete buttons", () => {
    render(<PortfolioActions {...defaultProps} />);
    expect(screen.getByText(/rename/i)).toBeInTheDocument();
    expect(screen.getByText(/add cash/i)).toBeInTheDocument();
    expect(screen.getByText(/delete/i)).toBeInTheDocument();
  });

  it("no dialog open on initial render", () => {
    render(<PortfolioActions {...defaultProps} />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  // ─── Rename Dialog ─────────────────────────────────────────────────────────

  it("opens rename dialog when Rename button is clicked", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    expect(screen.getByRole("heading", { name: /rename portfolio/i })).toBeInTheDocument();
  });

  it("rename dialog pre-fills with current portfolio name", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    expect((input as HTMLInputElement).value).toBe("My Portfolio");
  });

  it("Save button is disabled when name is unchanged", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();
  });

  it("Save button is disabled when name is blank", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "   " } });
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();
  });

  it("Save button enabled when name is changed", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "New Name" } });
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();
  });

  it("calls PATCH /api/portfolio/:id with new name on Save", async () => {
    const mockRefresh = vi.fn();
    const { useRouter } = await import("next/navigation");
    vi.mocked(useRouter).mockReturnValue({ refresh: mockRefresh } as any);

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ portfolio: { ...defaultProps, name: "New Name" } }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/portfolio/${defaultProps.portfolioId}`,
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"name":"New Name"'),
        })
      );
    });
  });

  it("shows success toast after successful rename", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ portfolio: {} }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Portfolio renamed"));
  });

  it("shows error toast when rename API fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to rename portfolio"));
  });

  it("shows error toast when rename throws", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Something went wrong"));
  });

  it("pressing Enter in name input triggers save", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ portfolio: {} }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    const input = screen.getByPlaceholderText("Portfolio name");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });

  // ─── Adjust Cash Dialog ────────────────────────────────────────────────────

  it("opens cash dialog when Add Cash button is clicked", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    expect(screen.getByRole("heading", { name: /adjust cash balance/i })).toBeInTheDocument();
  });

  it("cash dialog pre-fills with current cash balance", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    // Input of type number with value 3000
    const inputs = screen.getAllByRole("spinbutton");
    expect((inputs[0] as HTMLInputElement).value).toBe("3000");
  });

  it("calls PATCH /api/portfolio/:id with cashBalance on Update Cash", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ portfolio: {} }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    const input = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /update cash/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/portfolio/${defaultProps.portfolioId}`,
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining('"cashBalance":5000'),
        })
      );
    });
  });

  it("shows success toast after successful cash update", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ portfolio: {} }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    const input = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /update cash/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Cash balance updated"));
  });

  it("shows error toast when cash update API fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    const input = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: /update cash/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to update cash balance"));
  });

  it("Update Cash button is disabled when value is negative", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    const input = screen.getAllByRole("spinbutton")[0];
    fireEvent.change(input, { target: { value: "-100" } });
    const updateBtn = screen.getByRole("button", { name: /update cash/i });
    expect(updateBtn).toBeDisabled();
  });

  // ─── Delete Dialog ─────────────────────────────────────────────────────────

  it("opens delete dialog when Delete button is clicked", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(screen.getByRole("heading", { name: /delete portfolio/i })).toBeInTheDocument();
  });

  it("shows simple confirmation text when no holdings", () => {
    render(<PortfolioActions {...defaultProps} holdingsCount={0} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(screen.getByText(/are you sure/i)).toBeInTheDocument();
  });

  it("shows warning when portfolio has holdings", () => {
    render(<PortfolioActions {...defaultProps} holdingsCount={3} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(screen.getByText(/portfolio has holdings/i)).toBeInTheDocument();
    expect(screen.getByText(/3 holdings/i)).toBeInTheDocument();
  });

  it("shows singular 'holding' when holdingsCount is 1", () => {
    render(<PortfolioActions {...defaultProps} holdingsCount={1} />);
    fireEvent.click(screen.getByText(/delete/i));
    // Should say "1 holding" not "1 holdings"
    expect(screen.getByText(/1 holding[^s]/)).toBeInTheDocument();
  });

  it("calls DELETE /api/portfolio/:id on confirm delete", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/delete/i));
    fireEvent.click(screen.getByRole("button", { name: /delete portfolio/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        `/api/portfolio/${defaultProps.portfolioId}`,
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  it("shows success toast after successful delete", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/delete/i));
    fireEvent.click(screen.getByRole("button", { name: /delete portfolio/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Portfolio deleted"));
  });

  it("shows error toast when delete API fails", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockResolvedValue({ ok: false } as any);

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/delete/i));
    fireEvent.click(screen.getByRole("button", { name: /delete portfolio/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to delete portfolio"));
  });

  it("shows error toast when delete throws", async () => {
    const { toast } = await import("sonner");
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/delete/i));
    fireEvent.click(screen.getByRole("button", { name: /delete portfolio/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Something went wrong"));
  });

  it("Cancel button closes rename dialog", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/rename/i));
    expect(screen.getByRole("heading", { name: /rename portfolio/i })).toBeInTheDocument();
    // Click cancel (first Cancel button in the DOM)
    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtns[0]);
    expect(screen.queryByRole("heading", { name: /rename portfolio/i })).not.toBeInTheDocument();
  });

  it("Cancel button closes cash dialog", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/add cash/i));
    expect(screen.getByRole("heading", { name: /adjust cash balance/i })).toBeInTheDocument();
    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtns[0]);
    expect(screen.queryByRole("heading", { name: /adjust cash balance/i })).not.toBeInTheDocument();
  });

  it("Cancel button closes delete dialog", () => {
    render(<PortfolioActions {...defaultProps} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(screen.getByRole("heading", { name: /delete portfolio/i })).toBeInTheDocument();
    const cancelBtns = screen.getAllByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtns[0]);
    expect(screen.queryByRole("heading", { name: /delete portfolio/i })).not.toBeInTheDocument();
  });
});

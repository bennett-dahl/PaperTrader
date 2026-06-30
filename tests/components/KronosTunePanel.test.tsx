import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KronosTunePanel } from "@/components/KronosTunePanel";

const initialConfig = {
  kronosMinSignalPct: "1.0",
  kronosMinTradePct: "20",
  kronosMaxTradePct: "80",
  kronosSaturationPct: "5",
  kronosSizingCurve: "linear" as const,
  kronosTickerUniverse: ["AAPL", "MSFT"],
  maxPositions: 10,
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  minConfidenceThreshold: "0.65",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("KronosTunePanel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("renders all 4 major sections", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);

    expect(screen.getByText("Signal Thresholds")).toBeDefined();
    expect(screen.getByText("Signal-Proportional Sizing")).toBeDefined();
    expect(screen.getByText("Kronos Ticker Universe")).toBeDefined();
    expect(screen.getByText("Risk Controls")).toBeDefined();
  });

  it("renders existing tickers in the universe", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.getByText("MSFT")).toBeDefined();
  });

  it("shows example signal → trade size table", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    // Example signals include ±1%, ±2%, etc.
    expect(screen.getAllByText("±1%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("±5%").length).toBeGreaterThan(0);
  });

  it("shows curve type buttons", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    expect(screen.getByText("Linear")).toBeDefined();
    expect(screen.getByText("Logarithmic")).toBeDefined();
    expect(screen.getByText("Power")).toBeDefined();
  });

  it("does not show save bar initially (no dirty state)", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("shows save bar after changing curve type", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText("Logarithmic"));
    expect(screen.getByText("Unsaved changes")).toBeDefined();
  });

  it("curve type buttons toggle correctly", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    // Click Power button
    fireEvent.click(screen.getByText("Power"));
    // The description for power curve should appear
    expect(screen.getByText(/Conservative until you have high conviction/)).toBeDefined();
  });

  it("reset button restores initial values and clears dirty", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    // Dirty by clicking Logarithmic
    fireEvent.click(screen.getByText("Logarithmic"));
    expect(screen.getByText("Unsaved changes")).toBeDefined();
    // Reset
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("adding a ticker via Add button appends to list", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    const input = screen.getByPlaceholderText("Add ticker (e.g. AAPL)");
    fireEvent.change(input, { target: { value: "GOOG" } });
    fireEvent.click(screen.getByText("Add"));
    expect(screen.getByText("GOOG")).toBeDefined();
  });

  it("adding a ticker via Enter key appends to list", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    const input = screen.getByPlaceholderText("Add ticker (e.g. AAPL)");
    fireEvent.change(input, { target: { value: "TSLA" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("TSLA")).toBeDefined();
  });

  it("removing ticker via × removes from list", () => {
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    // Find the × button next to AAPL (it's inside the AAPL span)
    const removeButtons = screen.getAllByText("×");
    fireEvent.click(removeButtons[0]); // Remove first ticker (AAPL)
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  it("save calls PATCH with correct payload", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ pipeline: {} }) });
    const onSaved = vi.fn();
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={onSaved} />);
    
    // Make dirty
    fireEvent.click(screen.getByText("Logarithmic"));
    
    // Save
    fireEvent.click(screen.getByText("Save Changes"));
    
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/pipelines/pipe-1",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.kronosSizingCurve).toBe("log");
  });

  it("save error shows error message", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Unauthorized" }) });
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={vi.fn()} />);
    
    fireEvent.click(screen.getByText("Logarithmic"));
    fireEvent.click(screen.getByText("Save Changes"));
    
    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeDefined();
    });
  });

  it("calls onSaved after successful save", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const onSaved = vi.fn();
    render(<KronosTunePanel pipelineId="pipe-1" initial={initialConfig} onSaved={onSaved} />);
    
    fireEvent.click(screen.getByText("Logarithmic"));
    fireEvent.click(screen.getByText("Save Changes"));
    
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledOnce();
    });
  });
});

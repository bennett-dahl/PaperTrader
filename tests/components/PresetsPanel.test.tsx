import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PresetsPanel from "@/components/builder/PresetsPanel";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const mockPreset = {
  id: "preset-uuid-1",
  name: "My Preset",
  riskLevel: "medium" as const,
  investAmount: "1000.00",
  categories: ["Technology"],
  stockCount: 5,
  createdAt: "2025-01-01T00:00:00Z",
};

describe("PresetsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders 'No presets saved' when presets array is empty", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ presets: [] }),
    } as any);

    render(
      <PresetsPanel onApply={vi.fn()} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText(/no presets/i)).toBeInTheDocument();
    });
  });

  it("renders preset cards with name and riskLevel", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ presets: [mockPreset] }),
    } as any);

    render(
      <PresetsPanel onApply={vi.fn()} onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getByText("My Preset")).toBeInTheDocument();
    });
  });

  it("calls onApply when Apply button clicked", async () => {
    const onApply = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ presets: [mockPreset] }),
    } as any);

    render(
      <PresetsPanel onApply={onApply} onClose={vi.fn()} />
    );

    await waitFor(() => screen.getByText("My Preset"));
    // Click the "Apply" button in the preset card
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalled();
  });
});

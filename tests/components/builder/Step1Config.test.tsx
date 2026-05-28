import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Step1Config from "@/components/builder/Step1Config";

vi.mock("@/components/builder/PresetsPanel", () => ({
  default: () => <div data-testid="presets-panel" />,
}));

const mockPortfolio = {
  id: "p1",
  name: "My Portfolio",
  cashBalance: 5000,
  isDefault: true,
};

const mockConfig = {
  portfolioId: "p1",
  amount: 1000,
  riskLevel: "medium" as const,
  categories: [],
  stockCount: 5,
};

describe("Step1Config", () => {
  it("renders invest amount display", () => {
    render(
      <Step1Config
        portfolios={[mockPortfolio]}
        initialConfig={mockConfig}
        onSubmit={vi.fn()}
      />
    );
    // Amount is shown in the component
    const amounts = screen.getAllByText(/1,000|1000/);
    expect(amounts.length).toBeGreaterThan(0);
  });

  it("renders risk level options", () => {
    render(
      <Step1Config
        portfolios={[mockPortfolio]}
        initialConfig={mockConfig}
        onSubmit={vi.fn()}
      />
    );
    // Risk levels present (there will be multiple)
    const riskLabels = screen.getAllByText(/Conservative|Balanced|Aggressive/);
    expect(riskLabels.length).toBeGreaterThan(0);
  });

  it("renders Get Suggestions button", () => {
    render(
      <Step1Config
        portfolios={[mockPortfolio]}
        initialConfig={mockConfig}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /get suggestions/i })).toBeInTheDocument();
  });

  it("calls onSubmit when Get Suggestions clicked", () => {
    const onSubmit = vi.fn();
    render(
      <Step1Config
        portfolios={[mockPortfolio]}
        initialConfig={mockConfig}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /get suggestions/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("shows available cash balance", () => {
    render(
      <Step1Config
        portfolios={[mockPortfolio]}
        initialConfig={mockConfig}
        onSubmit={vi.fn()}
      />
    );
    const cashTexts = screen.getAllByText(/5,000|5000/);
    expect(cashTexts.length).toBeGreaterThan(0);
  });
});

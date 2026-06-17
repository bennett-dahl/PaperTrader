import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PortfolioPill from "@/components/PortfolioPill";

// ─── next/navigation ────────────────────────────────────────────────────────
const push = vi.fn();
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

// ─── ActivePortfolioContext ─────────────────────────────────────────────────
const setActivePortfolioId = vi.fn();
let activePortfolioId: string | null = "p1";
vi.mock("@/contexts/ActivePortfolioContext", () => ({
  useActivePortfolio: () => ({ activePortfolioId, setActivePortfolioId }),
}));

// ─── Sheet: render children only when open ──────────────────────────────────
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));

const multi = [
  { id: "p1", name: "Growth Fund" },
  { id: "p2", name: "Dividend Income" },
];

beforeEach(() => {
  push.mockClear();
  setActivePortfolioId.mockClear();
  pathname = "/dashboard";
  activePortfolioId = "p1";
});

describe("PortfolioPill", () => {
  it("renders nothing when there are no portfolios", () => {
    const { container } = render(<PortfolioPill portfolios={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("single portfolio", () => {
    const single = [{ id: "p1", name: "Growth Fund" }];

    it("shows the name without a chevron", () => {
      render(<PortfolioPill portfolios={single} />);
      expect(screen.getByText("Growth Fund")).toBeInTheDocument();
      // No expandable trigger for a single portfolio
      expect(screen.queryByRole("button", { expanded: false })).toBeNull();
    });

    it("navigates to /portfolios when tapped", () => {
      render(<PortfolioPill portfolios={single} />);
      fireEvent.click(screen.getByText("Growth Fund"));
      expect(push).toHaveBeenCalledWith("/portfolios");
    });
  });

  describe("multiple portfolios", () => {
    it("shows the active name and opens the sheet on tap", () => {
      render(<PortfolioPill portfolios={multi} />);
      const trigger = screen.getByRole("button", { expanded: false });
      expect(trigger).toHaveTextContent("Growth Fund");

      // Sheet list not present until opened
      expect(screen.queryByText("Switch portfolio")).toBeNull();
      fireEvent.click(trigger);
      expect(screen.getByText("Switch portfolio")).toBeInTheDocument();
      expect(screen.getByText("New portfolio")).toBeInTheDocument();
    });

    it("selecting a portfolio updates context and pushes URL on /dashboard", () => {
      render(<PortfolioPill portfolios={multi} />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByText("Dividend Income"));

      expect(setActivePortfolioId).toHaveBeenCalledWith("p2");
      expect(push).toHaveBeenCalledWith("?portfolio=p2");
    });

    it("does not push ?portfolio when not on /dashboard", () => {
      pathname = "/watchlist";
      render(<PortfolioPill portfolios={multi} />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByText("Dividend Income"));

      expect(setActivePortfolioId).toHaveBeenCalledWith("p2");
      expect(push).not.toHaveBeenCalled();
    });

    it("closes the sheet after a selection", () => {
      render(<PortfolioPill portfolios={multi} />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByText("Dividend Income"));
      expect(screen.queryByText("Switch portfolio")).toBeNull();
    });

    it("'New portfolio' navigates to /portfolios", () => {
      render(<PortfolioPill portfolios={multi} />);
      fireEvent.click(screen.getByRole("button", { expanded: false }));
      fireEvent.click(screen.getByText("New portfolio"));
      expect(push).toHaveBeenCalledWith("/portfolios");
      expect(setActivePortfolioId).not.toHaveBeenCalled();
    });

    it("falls back to the first portfolio when active id is unknown", () => {
      activePortfolioId = "missing";
      render(<PortfolioPill portfolios={multi} />);
      expect(
        screen.getByRole("button", { expanded: false })
      ).toHaveTextContent("Growth Fund");
    });
  });
});

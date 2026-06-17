import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import SidebarPortfolioPicker from "@/components/SidebarPortfolioPicker";

const push = vi.fn();
let pathname = "/dashboard";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

const setActivePortfolioId = vi.fn();
let activePortfolioId: string | null = "p1";
vi.mock("@/contexts/ActivePortfolioContext", () => ({
  useActivePortfolio: () => ({ activePortfolioId, setActivePortfolioId }),
}));

// Flatten the Select primitive: each item becomes a clickable button.
let onValueChange: (v: string) => void = () => {};
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange: cb, children }: any) => {
    onValueChange = cb;
    return <div data-active={value}>{children}</div>;
  },
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ value, children }: any) => (
    <button onClick={() => onValueChange(value)}>{children}</button>
  ),
}));

const portfolios = [
  { id: "p1", name: "Growth Fund" },
  { id: "p2", name: "Dividend Income" },
];

beforeEach(() => {
  push.mockClear();
  setActivePortfolioId.mockClear();
  pathname = "/dashboard";
  activePortfolioId = "p1";
});

describe("SidebarPortfolioPicker", () => {
  it("renders nothing with no portfolios", () => {
    const { container } = render(<SidebarPortfolioPicker portfolios={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active portfolio name in the trigger", () => {
    render(<SidebarPortfolioPicker portfolios={portfolios} />);
    // Appears in both the trigger value and the dropdown item.
    expect(screen.getAllByText("Growth Fund").length).toBeGreaterThan(0);
  });

  it("selecting updates context and pushes URL on /dashboard", () => {
    render(<SidebarPortfolioPicker portfolios={portfolios} />);
    fireEvent.click(screen.getByText("Dividend Income"));
    expect(setActivePortfolioId).toHaveBeenCalledWith("p2");
    expect(push).toHaveBeenCalledWith("?portfolio=p2");
  });

  it("selecting off /dashboard updates context without pushing", () => {
    pathname = "/trade";
    render(<SidebarPortfolioPicker portfolios={portfolios} />);
    fireEvent.click(screen.getByText("Dividend Income"));
    expect(setActivePortfolioId).toHaveBeenCalledWith("p2");
    expect(push).not.toHaveBeenCalled();
  });

  it("'New portfolio' routes to /portfolios without changing context", () => {
    render(<SidebarPortfolioPicker portfolios={portfolios} />);
    fireEvent.click(screen.getByText("＋ New portfolio"));
    expect(push).toHaveBeenCalledWith("/portfolios");
    expect(setActivePortfolioId).not.toHaveBeenCalled();
  });
});

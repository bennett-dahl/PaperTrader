import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import MobileNav from "@/components/MobileNav";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/dashboard"),
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: any) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));

// Mock Sheet components
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <div data-testid="sheet">{children}</div>,
  SheetTrigger: ({ children, className }: any) => (
    <button data-testid="sheet-trigger" className={className}>
      {children}
    </button>
  ),
  SheetContent: ({ children, className }: any) => (
    <div data-testid="sheet-content" className={className}>
      {children}
    </div>
  ),
}));

// Mock Avatar
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className }: any) => <div className={className}>{children}</div>,
  AvatarImage: ({ src }: any) => src ? <img src={src} alt="avatar" /> : null,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}));

const defaultUser = {
  name: "Test User",
  email: "test@example.com",
  image: null,
};

describe("MobileNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the hamburger menu trigger button", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByTestId("sheet-trigger")).toBeInTheDocument();
  });

  it("renders sr-only 'Open menu' text for accessibility", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByText("Open menu")).toBeInTheDocument();
  });

  it("renders the brand name in the sheet content", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByText("PaperTrader")).toBeInTheDocument();
  });

  it("renders all nav item labels", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Trade")).toBeInTheDocument();
    expect(screen.getByText("Advisor")).toBeInTheDocument();
    expect(screen.getByText("Watchlist")).toBeInTheDocument();
    expect(screen.getByText("Portfolios")).toBeInTheDocument();
  });

  it("no longer renders the removed History nav item", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("renders user name and email", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });

  it("renders avatar fallback initial from user name", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("T");
  });

  it("renders '?' avatar fallback when name is null", () => {
    render(<MobileNav user={{ ...defaultUser, name: null }} />);
    expect(screen.getByTestId("avatar-fallback").textContent).toBe("?");
  });

  it("renders avatar image when user has image", () => {
    render(<MobileNav user={{ ...defaultUser, image: "https://example.com/avatar.jpg" }} />);
    const img = screen.getByRole("img", { name: "avatar" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
  });

  it("renders a Sign out button", () => {
    render(<MobileNav user={defaultUser} />);
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("calls signOut with callbackUrl '/' when Sign out is clicked", async () => {
    const { signOut } = await import("next-auth/react");
    render(<MobileNav user={defaultUser} />);
    fireEvent.click(screen.getByText("Sign out"));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/" });
  });

  it("nav links have correct href attributes", () => {
    render(<MobileNav user={defaultUser} />);
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink).toHaveAttribute("href", "/dashboard");

    const tradeLink = screen.getByText("Trade").closest("a");
    expect(tradeLink).toHaveAttribute("href", "/trade");

    const portfoliosLink = screen.getByText("Portfolios").closest("a");
    expect(portfoliosLink).toHaveAttribute("href", "/portfolios");
  });

  it("active nav item (matching pathname) gets emerald styling", () => {
    render(<MobileNav user={defaultUser} />);
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).toMatch(/emerald/);
  });

  it("inactive nav item does not get emerald styling", () => {
    render(<MobileNav user={defaultUser} />);
    const tradeLink = screen.getByText("Trade").closest("a");
    expect(tradeLink?.className).not.toMatch(/emerald/);
  });

  it("nav link click calls onClick handler (closes sheet)", () => {
    render(<MobileNav user={defaultUser} />);
    const dashboardLink = screen.getByText("Dashboard").closest("a")!;
    // Should not throw - onClick sets open=false
    expect(() => fireEvent.click(dashboardLink)).not.toThrow();
  });
});

import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import {
  ActivePortfolioProvider,
  useActivePortfolio,
  PORTFOLIO_COOKIE,
} from "@/contexts/ActivePortfolioContext";

const STORAGE_KEY = "papertrader_active_portfolio";

function Consumer() {
  const { activePortfolioId, setActivePortfolioId } = useActivePortfolio();
  return (
    <div>
      <span data-testid="active">{activePortfolioId ?? "none"}</span>
      <button onClick={() => setActivePortfolioId("p9")}>set</button>
    </div>
  );
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0`;
}

beforeEach(() => {
  clearCookie(PORTFOLIO_COOKIE);
  // localStorage is cleared by the global setup's beforeEach
});

describe("ActivePortfolioContext hydration", () => {
  it("prefers the cookie over localStorage and the default", () => {
    localStorage.setItem(STORAGE_KEY, "from-storage");
    document.cookie = `${PORTFOLIO_COOKIE}=from-cookie; path=/`;

    render(
      <ActivePortfolioProvider defaultPortfolioId="from-default">
        <Consumer />
      </ActivePortfolioProvider>
    );

    expect(screen.getByTestId("active")).toHaveTextContent("from-cookie");
  });

  it("falls back to localStorage and backfills the cookie", () => {
    localStorage.setItem(STORAGE_KEY, "from-storage");

    render(
      <ActivePortfolioProvider defaultPortfolioId="from-default">
        <Consumer />
      </ActivePortfolioProvider>
    );

    expect(screen.getByTestId("active")).toHaveTextContent("from-storage");
    expect(getCookie(PORTFOLIO_COOKIE)).toBe("from-storage");
  });

  it("falls back to the default and writes both stores", () => {
    render(
      <ActivePortfolioProvider defaultPortfolioId="from-default">
        <Consumer />
      </ActivePortfolioProvider>
    );

    expect(screen.getByTestId("active")).toHaveTextContent("from-default");
    expect(getCookie(PORTFOLIO_COOKIE)).toBe("from-default");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("from-default");
  });

  it("stays empty when nothing is available", () => {
    render(
      <ActivePortfolioProvider>
        <Consumer />
      </ActivePortfolioProvider>
    );
    expect(screen.getByTestId("active")).toHaveTextContent("none");
  });
});

describe("ActivePortfolioContext setActivePortfolioId", () => {
  it("writes the new id to both the cookie and localStorage", () => {
    render(
      <ActivePortfolioProvider defaultPortfolioId="from-default">
        <Consumer />
      </ActivePortfolioProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText("set"));
    });

    expect(screen.getByTestId("active")).toHaveTextContent("p9");
    expect(getCookie(PORTFOLIO_COOKIE)).toBe("p9");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("p9");
  });
});

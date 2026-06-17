"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

import { PORTFOLIO_COOKIE } from "@/lib/portfolio-cookie";

export { PORTFOLIO_COOKIE };

const STORAGE_KEY = "papertrader_active_portfolio";
const COOKIE_MAX_AGE = 31536000; // 1 year

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(
    value
  )}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

interface ActivePortfolioContextValue {
  activePortfolioId: string | null;
  setActivePortfolioId: (id: string) => void;
}

const ActivePortfolioContext = createContext<ActivePortfolioContextValue>({
  activePortfolioId: null,
  setActivePortfolioId: () => {},
});

export function ActivePortfolioProvider({
  children,
  defaultPortfolioId,
}: {
  children: ReactNode;
  defaultPortfolioId?: string;
}) {
  const [activePortfolioId, setActivePortfolioIdState] = useState<string | null>(
    null
  );

  // Hydrate on mount: cookie is the source of truth, then localStorage,
  // then the server-provided default.
  useEffect(() => {
    const fromCookie = readCookie(PORTFOLIO_COOKIE);
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    const resolved = fromCookie ?? fromStorage ?? defaultPortfolioId ?? null;

    if (resolved) {
      setActivePortfolioIdState(resolved);
      // Backfill whichever store was missing so they stay in sync.
      if (!fromCookie) writeCookie(PORTFOLIO_COOKIE, resolved);
      if (!fromStorage) localStorage.setItem(STORAGE_KEY, resolved);
    }
  }, [defaultPortfolioId]);

  const setActivePortfolioId = useCallback((id: string) => {
    setActivePortfolioIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
    writeCookie(PORTFOLIO_COOKIE, id);
  }, []);

  return (
    <ActivePortfolioContext.Provider
      value={{ activePortfolioId, setActivePortfolioId }}
    >
      {children}
    </ActivePortfolioContext.Provider>
  );
}

export function useActivePortfolio() {
  return useContext(ActivePortfolioContext);
}

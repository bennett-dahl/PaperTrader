"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

const STORAGE_KEY = "papertrader_active_portfolio";

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

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setActivePortfolioIdState(stored);
    } else if (defaultPortfolioId) {
      setActivePortfolioIdState(defaultPortfolioId);
      localStorage.setItem(STORAGE_KEY, defaultPortfolioId);
    }
  }, [defaultPortfolioId]);

  const setActivePortfolioId = useCallback((id: string) => {
    setActivePortfolioIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
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

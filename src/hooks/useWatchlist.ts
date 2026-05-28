"use client";

import { useState, useEffect } from "react";

type WatchlistStatus = "loading" | "watching" | "not_watching" | "error";

export interface UseWatchlistReturn {
  status: WatchlistStatus;
  isToggling: boolean;
  toggle: () => Promise<void>;
}

export function useWatchlist(
  ticker: string,
  portfolioId: string | null
): UseWatchlistReturn {
  const [status, setStatus] = useState<WatchlistStatus>("loading");
  const [isToggling, setIsToggling] = useState(false);

  useEffect(() => {
    if (!ticker || !portfolioId) {
      setStatus("not_watching");
      return;
    }

    let cancelled = false;

    async function fetchStatus() {
      setStatus("loading");
      try {
        const res = await fetch(
          `/api/watchlist/${portfolioId}/${encodeURIComponent(ticker)}`
        );
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        if (!cancelled) {
          setStatus(data.watching ? "watching" : "not_watching");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [ticker, portfolioId]);

  const toggle = async () => {
    if (isToggling || status === "loading" || !portfolioId) return;
    const isWatching = status === "watching";
    setIsToggling(true);
    // Optimistic update
    setStatus(isWatching ? "not_watching" : "watching");
    try {
      const method = isWatching ? "DELETE" : "POST";
      const res = await fetch(
        `/api/watchlist/${portfolioId}/${encodeURIComponent(ticker)}`,
        { method }
      );
      if (!res.ok) throw new Error("Failed");
    } catch {
      // Revert on failure
      setStatus(isWatching ? "watching" : "not_watching");
    } finally {
      setIsToggling(false);
    }
  };

  return { status, isToggling, toggle };
}

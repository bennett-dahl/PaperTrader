import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";
import { inArray } from "drizzle-orm";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * For a given list of tickers, fetches any that are missing or stale from Finnhub
 * and upserts into cachedQuotes. Returns the refreshed quote map.
 *
 * Called by:
 * - /portfolios page (server-side, before computing portfolio values)
 * - /api/cron/snapshot (before taking daily snapshots)
 */
export async function refreshStaleQuotes(
  tickers: string[]
): Promise<Record<string, { price: number; change: number; changePercent: number }>> {
  if (tickers.length === 0) return {};

  const cached = await db
    .select()
    .from(cachedQuotes)
    .where(inArray(cachedQuotes.ticker, tickers));

  const now = Date.now();
  const quoteMap: Record<string, { price: number; change: number; changePercent: number }> = {};
  const staleTickers: string[] = [];

  for (const q of cached) {
    const age = now - new Date(q.updatedAt).getTime();
    quoteMap[q.ticker] = {
      price: parseFloat(q.price),
      change: parseFloat(q.change),
      changePercent: parseFloat(q.changePercent),
    };
    if (age > STALE_THRESHOLD_MS) {
      staleTickers.push(q.ticker);
    }
  }

  // Missing tickers (never cached)
  const missingTickers = tickers.filter((t) => !quoteMap[t]);
  const tickersToFetch = [...new Set([...staleTickers, ...missingTickers])];

  if (tickersToFetch.length === 0) return quoteMap;

  const client = getFinnhubClient();

  const results = await Promise.allSettled(
    tickersToFetch.map(async (ticker) => {
      const data = await fetchQuote(client, ticker);
      if (!data) return;

      await db
        .insert(cachedQuotes)
        .values({
          ticker,
          price: String(data.c),
          change: String(data.d ?? 0),
          changePercent: String(data.dp ?? 0),
        })
        .onConflictDoUpdate({
          target: cachedQuotes.ticker,
          set: {
            price: String(data.c),
            change: String(data.d ?? 0),
            changePercent: String(data.dp ?? 0),
            updatedAt: new Date(),
          },
        });

      quoteMap[ticker] = {
        price: data.c,
        change: data.d ?? 0,
        changePercent: data.dp ?? 0,
      };
    })
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error(
      "[refresh-quotes] Some fetches failed:",
      failed.map((r) => (r as PromiseRejectedResult).reason)
    );
  }

  return quoteMap;
}

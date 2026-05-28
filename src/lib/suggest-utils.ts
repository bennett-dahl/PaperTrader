import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";
import { featureFlags } from "@/lib/featureFlags";

export interface SuggestionItem {
  ticker: string;
  name: string;
  sector: string;
  category: string;
  riskLevel: string;
  marketCap: string;
  description: string | null;
  price: number;
  shares: number;
  allocatedAmount: number;
}

export async function getPrices(tickers: string[]): Promise<Record<string, number>> {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const priceMap: Record<string, number> = {};

  if (!featureFlags.SUGGEST_FORCE_FRESH_PRICES) {
    const cached = await db
      .select()
      .from(cachedQuotes)
      .where(inArray(cachedQuotes.ticker, tickers));

    const now = Date.now();
    const staleTickers: string[] = [];

    for (const q of cached) {
      const age = now - new Date(q.updatedAt).getTime();
      if (age > STALE_THRESHOLD_MS) {
        staleTickers.push(q.ticker);
      } else {
        priceMap[q.ticker] = parseFloat(q.price);
      }
    }

    const missingTickers = tickers.filter((t) => !priceMap[t]);
    const toFetch = [...new Set([...missingTickers, ...staleTickers])];

    if (toFetch.length > 0) {
      await fetchAndCachePrices(toFetch, priceMap);
    }
  } else {
    await fetchAndCachePrices(tickers, priceMap);
  }

  return priceMap;
}

export async function buildAllocations(
  tickers: string[],
  stocks: Array<{
    ticker: string;
    name: string;
    sector: string;
    category: string;
    riskLevel: string;
    marketCap: string;
    description: string | null;
  }>,
  totalAmount: number
): Promise<SuggestionItem[]> {
  const perStock = totalAmount / stocks.length;
  const priceMap = await getPrices(tickers);

  const result: SuggestionItem[] = [];

  for (const stock of stocks) {
    const price = priceMap[stock.ticker];
    if (!price || price <= 0) continue;

    const shares = Math.floor((perStock / price) * 10000) / 10000;
    if (shares <= 0) continue;

    result.push({
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      category: stock.category,
      riskLevel: stock.riskLevel,
      marketCap: stock.marketCap,
      description: stock.description,
      price,
      shares,
      allocatedAmount: Math.round(shares * price * 100) / 100,
    });
  }

  return result;
}

async function fetchAndCachePrices(
  tickers: string[],
  priceMap: Record<string, number>
) {
  const client = getFinnhubClient();

  await Promise.allSettled(
    tickers.map(async (ticker) => {
      try {
        const data = await fetchQuote(client, ticker);
        if (!data || !data.c) return;

        priceMap[ticker] = data.c;

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
      } catch (err) {
        console.error(`[suggest] Failed to fetch price for ${ticker}:`, err);
      }
    })
  );
}

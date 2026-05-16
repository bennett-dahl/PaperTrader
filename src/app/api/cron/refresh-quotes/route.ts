import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { holdings, watchlist, cachedQuotes } from "@/db/schema";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";

export async function POST(req: NextRequest) {
  // Protect with CRON_SECRET header
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Collect all tickers from holdings and watchlist
  const holdingTickers = await db
    .selectDistinct({ ticker: holdings.ticker })
    .from(holdings);

  const watchlistTickers = await db
    .selectDistinct({ ticker: watchlist.ticker })
    .from(watchlist);

  const allTickers = [
    ...new Set([
      ...holdingTickers.map((h) => h.ticker),
      ...watchlistTickers.map((w) => w.ticker),
    ]),
  ];

  if (allTickers.length === 0) {
    return NextResponse.json({ message: "No tickers to refresh", refreshed: 0 });
  }

  const client = getFinnhubClient();

  // Batch-fetch all quotes concurrently
  const results = await Promise.allSettled(
    allTickers.map(async (ticker) => {
      const data = await fetchQuote(client, ticker);
      if (!data) throw new Error(`No data for ${ticker}`);

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

      return ticker;
    })
  );

  const succeeded = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);

  const failed = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason?.message ?? "unknown");

  console.log(`[cron/refresh-quotes] Refreshed ${succeeded.length}/${allTickers.length} tickers`);
  if (failed.length > 0) console.error("[cron/refresh-quotes] Failures:", failed);

  return NextResponse.json({
    message: "Quotes refreshed",
    refreshed: succeeded.length,
    failed: failed.length,
    tickers: succeeded,
  });
}

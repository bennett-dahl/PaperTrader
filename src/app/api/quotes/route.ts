import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tickerParam = searchParams.get("tickers");

  if (!tickerParam) {
    return NextResponse.json({ error: "Missing tickers param" }, { status: 400 });
  }

  const tickers = tickerParam
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json({ quotes: {} });
  }

  const cached = await db
    .select()
    .from(cachedQuotes)
    .where(inArray(cachedQuotes.ticker, tickers));

  const now = Date.now();
  const result: Record<string, { price: number; change: number; changePercent: number; stale: boolean }> = {};

  for (const q of cached) {
    const age = now - new Date(q.updatedAt).getTime();
    result[q.ticker] = {
      price: parseFloat(q.price),
      change: parseFloat(q.change),
      changePercent: parseFloat(q.changePercent),
      stale: age > STALE_THRESHOLD_MS,
    };
  }

  // For tickers not in cache or stale, trigger a background refresh
  const staleOrMissing = tickers.filter(
    (t) => !result[t] || result[t].stale
  );

  if (staleOrMissing.length > 0) {
    // Fire-and-forget refresh for stale quotes
    refreshQuotes(staleOrMissing).catch(console.error);
  }

  return NextResponse.json({ quotes: result });
}

async function refreshQuotes(tickers: string[]) {
  const client = getFinnhubClient();

  // Batch-fetch all tickers concurrently (Finnhub free tier: 60 req/min)
  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
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
    })
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.error("[quotes] Some refreshes failed:", failed);
  }
}

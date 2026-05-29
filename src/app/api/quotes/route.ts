import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tickerParam = searchParams.get("tickers");

  if (tickerParam === null) {
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
  const result: Record<string, { price: number; change: number; changePercent: number; name: string | null; stale: boolean }> = {};

  for (const q of cached) {
    const age = now - new Date(q.updatedAt).getTime();
    result[q.ticker] = {
      price: parseFloat(q.price),
      change: parseFloat(q.change),
      changePercent: parseFloat(q.changePercent),
      name: q.name ?? null,
      stale: age > STALE_THRESHOLD_MS,
    };
  }

  // Separate missing tickers (not in cache at all) from stale ones
  const missingTickers = tickers.filter((t) => !result[t]);
  const staleTickers = tickers.filter((t) => result[t]?.stale);

  // For missing tickers, fetch synchronously so we have data to return
  if (missingTickers.length > 0) {
    await refreshQuotes(missingTickers).catch(console.error);
    const freshRows = await db
      .select()
      .from(cachedQuotes)
      .where(inArray(cachedQuotes.ticker, missingTickers));
    for (const q of freshRows) {
      const age = now - new Date(q.updatedAt).getTime();
      result[q.ticker] = {
        price: parseFloat(q.price),
        change: parseFloat(q.change),
        changePercent: parseFloat(q.changePercent),
        name: q.name ?? null,
        stale: age > STALE_THRESHOLD_MS,
      };
    }
  }

  // If force=true, await stale tickers synchronously so client gets fresh prices
  const force = searchParams.get("force") === "true";
  if (staleTickers.length > 0) {
    if (force) {
      await refreshQuotes(staleTickers).catch(console.error);
      const freshRows = await db
        .select()
        .from(cachedQuotes)
        .where(inArray(cachedQuotes.ticker, staleTickers));
      for (const q of freshRows) {
        const age = now - new Date(q.updatedAt).getTime();
        result[q.ticker] = {
          price: parseFloat(q.price),
          change: parseFloat(q.change),
          changePercent: parseFloat(q.changePercent),
          name: q.name ?? null,
          stale: age > STALE_THRESHOLD_MS,
        };
      }
    } else {
      // Fire-and-forget: client gets cached value immediately
      refreshQuotes(staleTickers).catch(console.error);
    }
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

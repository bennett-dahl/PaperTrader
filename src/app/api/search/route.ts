import { NextRequest, NextResponse } from "next/server";
import { getFinnhubClient, searchSymbols } from "@/lib/finnhub";
import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const client = getFinnhubClient();
    const results = await searchSymbols(client, q, 8);

    // Fire-and-forget: write names to cachedQuotes for any US_EQUITY results
    // This ensures names are available when stock detail fetches them
    const equities = results.filter(
      (r) => r.type === "Common Stock" || r.type === "EQS"
    );
    if (equities.length > 0) {
      Promise.allSettled(
        equities.map((r) =>
          db
            .insert(cachedQuotes)
            .values({
              ticker: r.symbol,
              name: r.description,
              price: "0",
              change: "0",
              changePercent: "0",
            })
            .onConflictDoUpdate({
              target: cachedQuotes.ticker,
              set: { name: r.description },
            })
        )
      ).catch(() => {});
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[api/search] Finnhub error:", err);
    return NextResponse.json({ results: [] });
  }
}

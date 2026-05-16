import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { portfolios, holdings, cachedQuotes, portfolioSnapshots } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  // Protect with Authorization header (Vercel sets this automatically for cron jobs)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allPortfolios = await db.select().from(portfolios);
  let snapshotCount = 0;

  for (const portfolio of allPortfolios) {
    const holdingsList = await db
      .select()
      .from(holdings)
      .where(eq(holdings.portfolioId, portfolio.id));

    const tickers = holdingsList.map((h) => h.ticker);
    const quotes =
      tickers.length > 0
        ? await db
            .select()
            .from(cachedQuotes)
            .where(inArray(cachedQuotes.ticker, tickers))
        : [];

    const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

    const holdingsValue = holdingsList.reduce((sum, h) => {
      const quote = quoteMap[h.ticker];
      const price = quote ? parseFloat(quote.price) : parseFloat(h.avgCostBasis);
      return sum + parseFloat(h.shares) * price;
    }, 0);

    const totalValue = parseFloat(portfolio.cashBalance) + holdingsValue;

    await db.insert(portfolioSnapshots).values({
      portfolioId: portfolio.id,
      totalValue: String(totalValue),
    });

    snapshotCount++;
  }

  return NextResponse.json({
    message: "Snapshots recorded",
    count: snapshotCount,
  });
}

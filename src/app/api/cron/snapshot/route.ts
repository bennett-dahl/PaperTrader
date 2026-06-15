import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { portfolios, holdings, portfolioSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { refreshStaleQuotes } from "@/lib/refresh-quotes";

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

    // Refresh stale quotes from Finnhub before snapshotting so we capture current prices
    const freshQuoteMap = await refreshStaleQuotes(tickers);

    const holdingsValue = holdingsList.reduce((sum, h) => {
      const quote = freshQuoteMap[h.ticker];
      const price = quote ? quote.price : parseFloat(h.avgCostBasis);
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

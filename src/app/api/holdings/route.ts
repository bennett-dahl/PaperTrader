import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { holdings, portfolios, users, cachedQuotes } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const portfolioId = searchParams.get("portfolioId");

  if (!portfolioId) {
    return NextResponse.json({ error: "Missing portfolioId param" }, { status: 400 });
  }

  // Get current user
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify portfolio belongs to user
  const portfolio = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1);

  if (!portfolio[0] || portfolio[0].userId !== dbUser[0].id) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  // Get holdings
  const holdingsList = await db
    .select()
    .from(holdings)
    .where(eq(holdings.portfolioId, portfolioId));

  // Get names from cachedQuotes
  const tickers = holdingsList.map((h) => h.ticker);
  const quotes =
    tickers.length > 0
      ? await db
          .select()
          .from(cachedQuotes)
          .where(inArray(cachedQuotes.ticker, tickers))
      : [];

  const nameMap = Object.fromEntries(quotes.map((q) => [q.ticker, q.name ?? ""]));

  return NextResponse.json({
    holdings: holdingsList.map((h) => ({
      ticker: h.ticker,
      name: nameMap[h.ticker] ?? "",
      shares: parseFloat(h.shares),
      avgCostBasis: parseFloat(h.avgCostBasis),
    })),
    cashBalance: parseFloat(portfolio[0].cashBalance),
  });
}

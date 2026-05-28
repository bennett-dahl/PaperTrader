import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, portfolios, holdings, transactions, cachedQuotes } from "@/db/schema";
import { eq, and } from "drizzle-orm";

interface AllocationItem {
  ticker: string;
  shares: number;
  price: number;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { portfolioId, allocations } = body as {
    portfolioId: string;
    allocations: AllocationItem[];
  };

  if (!portfolioId || !Array.isArray(allocations) || allocations.length === 0) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const portfolio = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, dbUser[0].id)))
    .limit(1);

  if (!portfolio[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const results: Array<{
    ticker: string;
    success: boolean;
    shares?: number;
    price?: number;
    totalAmount?: number;
    error?: string;
  }> = [];

  // Execute each trade sequentially within a transaction
  // We do partial failure: if one fails, the rest still proceed
  for (const allocation of allocations) {
    const { ticker, shares, price } = allocation;

    if (!ticker || !shares || shares <= 0 || !price || price <= 0) {
      results.push({ ticker: ticker ?? "unknown", success: false, error: "Invalid allocation" });
      continue;
    }

    const totalCost = price * shares;

    try {
      await db.transaction(async (tx) => {
        // Re-read cash balance inside transaction
        const [currentPortfolio] = await tx
          .select()
          .from(portfolios)
          .where(eq(portfolios.id, portfolioId))
          .limit(1);

        const cashBalance = parseFloat(currentPortfolio.cashBalance);

        if (totalCost > cashBalance) {
          throw Object.assign(
            new Error(`Insufficient cash for ${ticker}. Need $${totalCost.toFixed(2)}, have $${cashBalance.toFixed(2)}`),
            { status: 422 }
          );
        }

        const tickerUpper = ticker.toUpperCase();

        // Check existing holding
        const existing = await tx
          .select()
          .from(holdings)
          .where(and(eq(holdings.portfolioId, portfolioId), eq(holdings.ticker, tickerUpper)))
          .limit(1);

        if (existing[0]) {
          const existingShares = parseFloat(existing[0].shares);
          const existingCost = parseFloat(existing[0].avgCostBasis);
          const newShares = existingShares + shares;
          const newAvg = (existingShares * existingCost + shares * price) / newShares;

          await tx
            .update(holdings)
            .set({ shares: String(newShares), avgCostBasis: String(newAvg) })
            .where(eq(holdings.id, existing[0].id));
        } else {
          await tx.insert(holdings).values({
            portfolioId,
            ticker: tickerUpper,
            shares: String(shares),
            avgCostBasis: String(price),
          });
        }

        // Deduct cash
        await tx
          .update(portfolios)
          .set({ cashBalance: String(cashBalance - totalCost) })
          .where(eq(portfolios.id, portfolioId));

        // Record transaction
        await tx.insert(transactions).values({
          portfolioId,
          ticker: tickerUpper,
          type: "BUY",
          shares: String(shares),
          pricePerShare: String(price),
          totalAmount: String(totalCost),
        });
      });

      results.push({ ticker, success: true, shares, price, totalAmount: totalCost });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Trade failed";
      results.push({ ticker, success: false, error: message });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  return NextResponse.json({
    results,
    successCount,
    failCount,
    totalTrades: results.length,
  });
}

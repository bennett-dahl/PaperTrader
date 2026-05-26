import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, holdings, transactions, users, cachedQuotes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { ticker, type, shares, portfolioId } = body as {
    ticker: string;
    type: "BUY" | "SELL";
    shares: number;
    portfolioId: string;
  };

  if (!ticker || !type || !shares || !portfolioId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (shares <= 0) {
    return NextResponse.json({ error: "Shares must be positive" }, { status: 400 });
  }

  // Verify portfolio belongs to user
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

  // Get current price from cache
  let quote = await db
    .select()
    .from(cachedQuotes)
    .where(eq(cachedQuotes.ticker, ticker.toUpperCase()))
    .limit(1);

  // If no cached quote, fetch live from Finnhub
  if (!quote[0]) {
    try {
      const client = getFinnhubClient();
      const data = await fetchQuote(client, ticker.toUpperCase());

      if (data) {
        await db
          .insert(cachedQuotes)
          .values({
            ticker: ticker.toUpperCase(),
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

        // Re-fetch from DB so we use the canonical record
        quote = await db
          .select()
          .from(cachedQuotes)
          .where(eq(cachedQuotes.ticker, ticker.toUpperCase()))
          .limit(1);
      }
    } catch (err) {
      console.error("[trade] Finnhub fetch failed:", err);
    }
  }

  if (!quote[0]) {
    return NextResponse.json(
      { error: "No price data available for this ticker. Try again in a moment." },
      { status: 422 }
    );
  }

  const price = parseFloat(quote[0].price);
  const totalCost = price * shares;

  // Wrap all trade execution in a transaction to prevent race conditions
  // (concurrent requests on the same portfolio could double-spend cash or corrupt share counts)
  let tradeResult: { type: string; ticker: string; shares: number; pricePerShare: number; totalAmount: number };
  try {
    tradeResult = await db.transaction(async (tx) => {
      // Re-read cash balance inside the transaction for consistency
      const [currentPortfolio] = await tx
        .select()
        .from(portfolios)
        .where(eq(portfolios.id, portfolioId))
        .limit(1);
      const cashBalance = parseFloat(currentPortfolio.cashBalance);

      if (type === "BUY") {
        if (totalCost > cashBalance) {
          throw Object.assign(
            new Error(`Insufficient cash. You need $${totalCost.toFixed(2)} but have $${cashBalance.toFixed(2)}`),
            { status: 422 }
          );
        }

        // Check if existing holding
        const existing = await tx
          .select()
          .from(holdings)
          .where(
            and(
              eq(holdings.portfolioId, portfolioId),
              eq(holdings.ticker, ticker.toUpperCase())
            )
          )
          .limit(1);

        if (existing[0]) {
          // Update average cost basis
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
            ticker: ticker.toUpperCase(),
            shares: String(shares),
            avgCostBasis: String(price),
          });
        }

        // Deduct cash
        await tx
          .update(portfolios)
          .set({ cashBalance: String(cashBalance - totalCost) })
          .where(eq(portfolios.id, portfolioId));
      } else {
        // SELL
        const existing = await tx
          .select()
          .from(holdings)
          .where(
            and(
              eq(holdings.portfolioId, portfolioId),
              eq(holdings.ticker, ticker.toUpperCase())
            )
          )
          .limit(1);

        if (!existing[0]) {
          throw Object.assign(new Error("You don't hold this stock"), { status: 422 });
        }

        const existingShares = parseFloat(existing[0].shares);
        if (shares > existingShares) {
          throw Object.assign(
            new Error(`You only have ${existingShares.toFixed(4)} shares to sell`),
            { status: 422 }
          );
        }

        const newShares = existingShares - shares;
        if (newShares < 0.0001) {
          // Remove holding entirely
          await tx.delete(holdings).where(eq(holdings.id, existing[0].id));
        } else {
          await tx
            .update(holdings)
            .set({ shares: String(newShares) })
            .where(eq(holdings.id, existing[0].id));
        }

        // Add cash
        await tx
          .update(portfolios)
          .set({ cashBalance: String(cashBalance + totalCost) })
          .where(eq(portfolios.id, portfolioId));
      }

      // Record transaction
      await tx.insert(transactions).values({
        portfolioId,
        ticker: ticker.toUpperCase(),
        type,
        shares: String(shares),
        pricePerShare: String(price),
        totalAmount: String(totalCost),
      });

      return {
        type,
        ticker: ticker.toUpperCase(),
        shares,
        pricePerShare: price,
        totalAmount: totalCost,
      };
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Trade failed";
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ success: true, trade: tradeResult });
}

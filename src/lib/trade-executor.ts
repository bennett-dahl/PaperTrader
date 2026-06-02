import { db } from "@/db";
import { holdings, portfolios, transactions, cachedQuotes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";

export interface ExecuteTradeParams {
  portfolioId: string;
  ticker: string;
  type: "BUY" | "SELL";
  shares: number;
  userId: string;
  /** Optional pre-fetched price. If omitted, executeTrade fetches from cache/Finnhub. */
  price?: number;
}

export interface ExecuteTradeResult {
  success: boolean;
  error?: string;
}

/**
 * Execute a single trade within a DB transaction.
 * Validates portfolio ownership, cash balance, and holding existence.
 * Both /api/trade and the pipeline run executor call this directly.
 */
export async function executeTrade(params: ExecuteTradeParams): Promise<ExecuteTradeResult> {
  const { portfolioId, ticker, type, shares, userId } = params;

  if (!ticker || !type || !shares || shares <= 0) {
    return { success: false, error: "Invalid trade parameters" };
  }

  let price = params.price;

  if (price === undefined) {
    // Get price from cache, fetch live if missing
    let quoteRows = await db
      .select()
      .from(cachedQuotes)
      .where(eq(cachedQuotes.ticker, ticker.toUpperCase()))
      .limit(1);

    if (!quoteRows[0]) {
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
          quoteRows = await db
            .select()
            .from(cachedQuotes)
            .where(eq(cachedQuotes.ticker, ticker.toUpperCase()))
            .limit(1);
        }
      } catch (err) {
        console.error("[trade-executor] Finnhub fetch failed:", err);
      }
    }

    if (!quoteRows[0]) {
      return { success: false, error: "no_price_data" };
    }

    price = parseFloat(quoteRows[0].price);
  }

  const totalCost = price * shares;

  try {
    await db.transaction(async (tx) => {
      const [currentPortfolio] = await tx
        .select()
        .from(portfolios)
        .where(eq(portfolios.id, portfolioId))
        .limit(1);

      if (!currentPortfolio) {
        throw Object.assign(new Error("Portfolio not found"), { code: "portfolio_not_found" });
      }

      if (currentPortfolio.userId !== userId) {
        throw Object.assign(new Error("Unauthorized"), { code: "unauthorized" });
      }

      const cashBalance = parseFloat(currentPortfolio.cashBalance);

      if (type === "BUY") {
        if (totalCost > cashBalance) {
          throw Object.assign(
            new Error(`Insufficient cash. Need $${totalCost.toFixed(2)} but have $${cashBalance.toFixed(2)}`),
            { code: "insufficient_cash" }
          );
        }

        const existing = await tx
          .select()
          .from(holdings)
          .where(and(eq(holdings.portfolioId, portfolioId), eq(holdings.ticker, ticker.toUpperCase())))
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
            ticker: ticker.toUpperCase(),
            shares: String(shares),
            avgCostBasis: String(price),
          });
        }

        await tx
          .update(portfolios)
          .set({ cashBalance: String(cashBalance - totalCost) })
          .where(eq(portfolios.id, portfolioId));
      } else {
        // SELL
        const existing = await tx
          .select()
          .from(holdings)
          .where(and(eq(holdings.portfolioId, portfolioId), eq(holdings.ticker, ticker.toUpperCase())))
          .limit(1);

        if (!existing[0]) {
          throw Object.assign(new Error("You don't hold this stock"), { code: "no_holding" });
        }

        const existingShares = parseFloat(existing[0].shares);
        if (shares > existingShares) {
          throw Object.assign(
            new Error(`You only have ${existingShares.toFixed(4)} shares to sell`),
            { code: "insufficient_shares" }
          );
        }

        const newShares = existingShares - shares;
        if (newShares < 0.0001) {
          await tx.delete(holdings).where(eq(holdings.id, existing[0].id));
        } else {
          await tx.update(holdings).set({ shares: String(newShares) }).where(eq(holdings.id, existing[0].id));
        }

        await tx
          .update(portfolios)
          .set({ cashBalance: String(cashBalance + totalCost) })
          .where(eq(portfolios.id, portfolioId));
      }

      await tx.insert(transactions).values({
        portfolioId,
        ticker: ticker.toUpperCase(),
        type,
        shares: String(shares),
        pricePerShare: String(price),
        totalAmount: String(totalCost),
      });
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Trade failed";
    return { success: false, error: message };
  }
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users, holdings, cachedQuotes } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { HoldingWithPrice } from "@/types";
import PortfolioDetailTabs from "@/components/PortfolioDetailTabs";
import { refreshStaleQuotes } from "@/lib/refresh-quotes";

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  const { id: portfolioId } = await params;

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) redirect("/");

  // Verify ownership by fetching all user portfolios
  const allPortfolios = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id));

  const portfolio = allPortfolios.find((p) => p.id === portfolioId);
  if (!portfolio) redirect("/dashboard");

  // Fetch holdings
  const holdingsList = await db
    .select()
    .from(holdings)
    .where(eq(holdings.portfolioId, portfolioId));

  // Gather tickers, then refresh stale quotes before reading cache.
  // This matches the pattern used in the portfolio list page and snapshot cron.
  const tickers = holdingsList.map((h) => h.ticker);
  if (tickers.length > 0) {
    await refreshStaleQuotes(tickers);
  }

  // Fetch cached quotes for enrichment
  const quotes =
    tickers.length > 0
      ? await db
          .select()
          .from(cachedQuotes)
          .where(inArray(cachedQuotes.ticker, tickers))
      : [];

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  // Build HoldingWithPrice — raw DB fields are strings; parse to numbers.
  // name cannot be null in HoldingWithPrice; fall back to "".
  // changePercent is required; omit (undefined) when no quote available.
  const holdingsWithPrice: HoldingWithPrice[] = holdingsList.map((h) => {
    const quote = quoteMap[h.ticker];
    return {
      ticker: h.ticker,
      name: quote?.name ?? "",
      shares: parseFloat(h.shares),
      avgCostBasis: parseFloat(h.avgCostBasis),
      currentPrice: quote ? parseFloat(quote.price) : undefined,
      change: quote ? parseFloat(quote.change) : undefined,
      changePercent: quote ? parseFloat(quote.changePercent) : undefined,
    };
  });

  // Compute the three numeric props LivePortfolioDashboard requires
  const initialCashBalance = parseFloat(portfolio.cashBalance);
  const holdingsValue = holdingsWithPrice.reduce((sum, h) => {
    const price = h.currentPrice ?? h.avgCostBasis;
    return sum + h.shares * price;
  }, 0);
  const initialTotalValue = initialCashBalance + holdingsValue;

  return (
    <PortfolioDetailTabs
      portfolio={portfolio}
      initialHoldings={holdingsWithPrice}
      initialCashBalance={initialCashBalance}
      initialTotalValue={initialTotalValue}
      startingBalance={parseFloat(portfolio.startingBalance)}
    />
  );
}

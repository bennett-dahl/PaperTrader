import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, holdings, users, cachedQuotes } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import PriceChart from "@/components/PriceChart";
import PortfolioSwitcher from "@/components/PortfolioSwitcher";
import LivePortfolioDashboard from "@/components/LivePortfolioDashboard";
import { portfolioSnapshots } from "@/db/schema";
import { desc } from "drizzle-orm";
import { HoldingWithPrice } from "@/types";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ portfolio?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) redirect("/");

  // Get all portfolios for the user
  const allPortfolios = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id));

  if (allPortfolios.length === 0) redirect("/onboarding");

  // Resolve selected portfolio from search params
  const { portfolio: portfolioParam } = await searchParams;
  const portfolio =
    (portfolioParam
      ? allPortfolios.find((p) => p.id === portfolioParam)
      : undefined) ??
    allPortfolios.find((p) => p.isDefault) ??
    allPortfolios[0];

  // Get holdings
  const holdingsList = await db
    .select()
    .from(holdings)
    .where(eq(holdings.portfolioId, portfolio.id));

  // Get quotes for holdings
  const tickers = holdingsList.map((h) => h.ticker);
  const quotes =
    tickers.length > 0
      ? await db
          .select()
          .from(cachedQuotes)
          .where(inArray(cachedQuotes.ticker, tickers))
      : [];

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  // Build initialHoldings with SSR-hydrated prices
  const initialHoldings: HoldingWithPrice[] = holdingsList.map((h) => {
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

  const initialCashBalance = parseFloat(portfolio.cashBalance);
  const holdingsValue = initialHoldings.reduce((sum, h) => {
    const price = h.currentPrice ?? h.avgCostBasis;
    return sum + h.shares * price;
  }, 0);
  const initialTotalValue = initialCashBalance + holdingsValue;

  // Get snapshots for chart
  const snapshots = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.portfolioId, portfolio.id))
    .orderBy(desc(portfolioSnapshots.snapshotAt))
    .limit(96); // ~24h of 15-min snapshots

  const chartData = snapshots
    .reverse()
    .map((s) => ({
      time: new Date(s.snapshotAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      value: parseFloat(s.totalValue),
    }));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Hey, {session.user.name?.split(" ")[0]} 👋
        </h1>
        <div className="flex items-center gap-3 mt-2">
          <p className="text-slate-400 text-sm">{portfolio.name}</p>
          <PortfolioSwitcher
            portfolios={allPortfolios.map((p) => ({ id: p.id, name: p.name }))}
            selectedId={portfolio.id}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Link
          href={`/portfolios/${portfolio.id}`}
          className="text-sm text-violet-400 hover:text-violet-300 transition-colors"
        >
          View detail →
        </Link>
      </div>

      <LivePortfolioDashboard
        portfolioId={portfolio.id}
        initialHoldings={initialHoldings}
        initialCashBalance={initialCashBalance}
        initialTotalValue={initialTotalValue}
        startingBalance={parseFloat(portfolio.startingBalance)}
      />

      {chartData.length > 1 && (
        <div className="glass rounded-2xl p-4">
          <h2 className="text-sm font-medium text-slate-400 mb-4">
            Portfolio Value
          </h2>
          <PriceChart data={chartData} />
        </div>
      )}
    </div>
  );
}

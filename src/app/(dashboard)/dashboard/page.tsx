import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, holdings, users, cachedQuotes } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import PortfolioCard from "@/components/PortfolioCard";
import HoldingRow from "@/components/HoldingRow";
import PriceChart from "@/components/PriceChart";
import PortfolioSwitcher from "@/components/PortfolioSwitcher";
import { portfolioSnapshots } from "@/db/schema";
import { desc } from "drizzle-orm";

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

  // Calculate portfolio market value
  const holdingsValue = holdingsList.reduce((sum, h) => {
    const quote = quoteMap[h.ticker];
    const price = quote ? parseFloat(quote.price) : parseFloat(h.avgCostBasis);
    return sum + parseFloat(h.shares) * price;
  }, 0);

  const totalValue = parseFloat(portfolio.cashBalance) + holdingsValue;
  const totalReturn = totalValue - parseFloat(portfolio.startingBalance);
  const totalReturnPct =
    (totalReturn / parseFloat(portfolio.startingBalance)) * 100;

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

      <PortfolioCard
        totalValue={totalValue}
        cashBalance={parseFloat(portfolio.cashBalance)}
        holdingsValue={holdingsValue}
        totalReturn={totalReturn}
        totalReturnPct={totalReturnPct}
      />

      {chartData.length > 1 && (
        <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">
          <h2 className="text-sm font-medium text-slate-400 mb-4">
            Portfolio Value
          </h2>
          <PriceChart data={chartData} />
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Holdings</h2>
        {holdingsList.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
            <p className="text-slate-400 mb-1">No holdings yet</p>
            <p className="text-slate-500 text-sm">
              Head to Trade to make your first buy
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {holdingsList.map((holding) => (
              <HoldingRow
                key={holding.id}
                ticker={holding.ticker}
                name={quoteMap[holding.ticker]?.name ?? undefined}
                shares={parseFloat(holding.shares)}
                avgCostBasis={parseFloat(holding.avgCostBasis)}
                portfolioId={portfolio.id}
                currentPrice={quoteMap[holding.ticker] ? parseFloat(quoteMap[holding.ticker].price) : undefined}
                change={quoteMap[holding.ticker] ? parseFloat(quoteMap[holding.ticker].change) : undefined}
                changePercent={quoteMap[holding.ticker] ? parseFloat(quoteMap[holding.ticker].changePercent) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users, holdings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { refreshStaleQuotes } from "@/lib/refresh-quotes";
import { Badge } from "@/components/ui/badge";
import CreatePortfolioButton from "@/components/CreatePortfolioButton";
import PortfolioActions from "@/components/PortfolioActions";

export default async function PortfoliosPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) redirect("/");

  const userPortfolios = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id));

  // Load all holdings across all portfolios, then refresh stale quotes in one pass
  const allHoldingsList = await Promise.all(
    userPortfolios.map((p) =>
      db.select().from(holdings).where(eq(holdings.portfolioId, p.id))
    )
  );

  const allTickers = [
    ...new Set(allHoldingsList.flat().map((h) => h.ticker)),
  ];

  // Refresh any stale or missing quotes from Finnhub before computing values
  const freshQuoteMap = await refreshStaleQuotes(allTickers);

  // Get aggregate values for each portfolio
  const enriched = userPortfolios.map((p, i) => {
    const holdingsList = allHoldingsList[i];

    const holdingsValue = holdingsList.reduce((sum, h) => {
      const quote = freshQuoteMap[h.ticker];
      const price = quote ? quote.price : parseFloat(h.avgCostBasis);
      return sum + parseFloat(h.shares) * price;
    }, 0);

    const totalValue = parseFloat(p.cashBalance) + holdingsValue;
    const totalReturn = totalValue - parseFloat(p.startingBalance);
    const pct = (totalReturn / parseFloat(p.startingBalance)) * 100;

    return { ...p, totalValue, totalReturn, pct, holdingsCount: holdingsList.length };
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolios</h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage your paper trading accounts
          </p>
        </div>
        <CreatePortfolioButton userId={dbUser[0].id} />
      </div>

      <div className="space-y-3">
        {enriched.map((p) => (
          <div
            key={p.id}
            className="glass rounded-2xl px-5 py-4 space-y-3"
          >
            <Link
              href={`/portfolios/${p.id}`}
              className="block space-y-3 -m-1 p-1 rounded-xl transition-colors hover:bg-slate-800/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{p.name}</p>
                  {p.isDefault && (
                    <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 text-xs">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="font-bold text-lg">${p.totalValue.toFixed(2)}</p>
              </div>
              <div className="flex justify-between text-sm text-slate-400">
                <span>{p.holdingsCount} holdings</span>
                <span
                  className={p.totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}
                >
                  {p.totalReturn >= 0 ? "+" : ""}
                  {p.pct.toFixed(2)}% all time
                </span>
              </div>
            </Link>
            {/* Portfolio actions */}
            <PortfolioActions
              portfolioId={p.id}
              portfolioName={p.name}
              cashBalance={parseFloat(p.cashBalance)}
              holdingsCount={p.holdingsCount}
              isDefault={p.isDefault}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users, watchlist, cachedQuotes } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) redirect("/");

  const portfolio = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id))
    .limit(1)
    .then((rows) => rows.find((p) => p.isDefault) ?? rows[0]);

  if (!portfolio) redirect("/onboarding");

  const watchlistItems = await db
    .select()
    .from(watchlist)
    .where(eq(watchlist.portfolioId, portfolio.id));

  const tickers = watchlistItems.map((w) => w.ticker);
  const quotes =
    tickers.length > 0
      ? await db
          .select()
          .from(cachedQuotes)
          .where(inArray(cachedQuotes.ticker, tickers))
      : [];

  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <p className="text-slate-400 text-sm mt-1">
          Stocks you're keeping an eye on
        </p>
      </div>

      {watchlistItems.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
          <p className="text-slate-400 mb-1">Your watchlist is empty</p>
          <p className="text-slate-500 text-sm">
            Add stocks from the Trade page to track them here
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {watchlistItems.map((item) => {
            const quote = quoteMap[item.ticker];
            const isUp = quote ? parseFloat(quote.changePercent) >= 0 : null;

            return (
              <div
                key={item.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-4 flex items-center justify-between min-h-[64px]"
              >
                <div>
                  <p className="font-bold">{item.ticker}</p>
                  <p className="text-slate-500 text-xs">
                    Added{" "}
                    {new Date(item.addedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>

                <div className="text-right">
                  {quote ? (
                    <>
                      <p className="font-semibold">
                        ${parseFloat(quote.price).toFixed(2)}
                      </p>
                      <Badge
                        variant={isUp ? "default" : "destructive"}
                        className={`text-xs gap-1 ${isUp ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20" : ""}`}
                      >
                        {isUp ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {parseFloat(quote.changePercent) >= 0 ? "+" : ""}
                        {parseFloat(quote.changePercent).toFixed(2)}%
                      </Badge>
                    </>
                  ) : (
                    <p className="text-slate-500 text-sm">No data</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

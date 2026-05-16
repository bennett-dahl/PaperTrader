import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users, transactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";

export default async function HistoryPage() {
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

  const txns = await db
    .select()
    .from(transactions)
    .where(eq(transactions.portfolioId, portfolio.id))
    .orderBy(desc(transactions.executedAt))
    .limit(100);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Transaction History</h1>
        <p className="text-slate-400 text-sm mt-1">
          Every trade you've made in {portfolio.name}
        </p>
      </div>

      {txns.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center">
          <p className="text-slate-400 mb-1">No transactions yet</p>
          <p className="text-slate-500 text-sm">
            Your trades will appear here after your first buy
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {txns.map((txn) => {
            const isBuy = txn.type === "BUY";
            return (
              <div
                key={txn.id}
                className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <Badge
                    className={
                      isBuy
                        ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 font-bold"
                        : "bg-red-500/20 text-red-400 hover:bg-red-500/20 font-bold"
                    }
                  >
                    {txn.type}
                  </Badge>
                  <div>
                    <p className="font-semibold">{txn.ticker}</p>
                    <p className="text-slate-500 text-xs">
                      {parseFloat(txn.shares).toFixed(4)} shares @{" "}
                      ${parseFloat(txn.pricePerShare).toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${isBuy ? "text-red-400" : "text-emerald-400"}`}>
                    {isBuy ? "-" : "+"}${parseFloat(txn.totalAmount).toFixed(2)}
                  </p>
                  <p className="text-slate-500 text-xs">
                    {new Date(txn.executedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import BottomNav from "@/components/BottomNav";
import Sidebar from "@/components/Sidebar";
import { TrendingUp } from "lucide-react";
import { ActivePortfolioProvider } from "@/contexts/ActivePortfolioContext";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  // Check onboarding
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

  if (userPortfolios.length === 0) redirect("/onboarding");

  // Determine default portfolio for context initialization
  const defaultPortfolio =
    userPortfolios.find((p) => p.isDefault) ?? userPortfolios[0];

  return (
    <ActivePortfolioProvider defaultPortfolioId={defaultPortfolio.id}>
      <div className="min-h-screen bg-slate-950 text-white flex flex-col sm:flex-row">
        {/* Desktop sidebar */}
        <Sidebar user={session.user} />

        {/* Main content */}
        <main className="flex-1 pb-20 sm:pb-0 sm:pl-64 min-h-screen">
          {/* Mobile header */}
          <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800 sm:hidden sticky top-0 bg-slate-950/95 backdrop-blur z-10">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              <span className="font-bold text-lg">PaperTrader</span>
            </div>
            <div className="flex items-center gap-3">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  className="h-8 w-8 rounded-full"
                />
              )}
            </div>
          </header>

          <div className="p-4 sm:p-8">{children}</div>
        </main>

        {/* Mobile bottom nav */}
        <BottomNav />
      </div>
    </ActivePortfolioProvider>
  );
}

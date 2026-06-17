import { auth } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import MobileNav from "@/components/MobileNav";
import MobileTabBar from "@/components/MobileTabBar";
import Sidebar from "@/components/Sidebar";
import PortfolioPill from "@/components/PortfolioPill";
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
      <div className="min-h-screen text-foreground flex flex-col sm:flex-row">
        {/* Desktop sidebar */}
        <Sidebar
          user={session.user}
          portfolios={userPortfolios.map((p) => ({ id: p.id, name: p.name }))}
        />

        {/* Main content */}
        <main className="flex-1 min-h-screen sm:pl-64">
          {/* Mobile header — glass, hairline border, minimal height */}
          <header className="flex items-center justify-between gap-3 px-4 py-2.5 sm:hidden sticky top-0 z-20 glass border-b border-glass-border">
            <Link href="/dashboard" className="shrink-0" aria-label="PaperTrader home">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-400/10 shadow-glow-sm">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
              </span>
            </Link>

            <PortfolioPill
              portfolios={userPortfolios.map((p) => ({ id: p.id, name: p.name }))}
            />

            <div className="flex items-center gap-2 shrink-0">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  className="h-8 w-8 rounded-full ring-1 ring-glass-border"
                />
              )}
              <MobileNav user={session.user} />
            </div>
          </header>

          {/* Bottom padding so the fixed tab bar never covers content */}
          <div className="p-4 pb-28 sm:p-8 sm:pb-8">{children}</div>
        </main>

        {/* Mobile bottom tab bar */}
        <MobileTabBar />
      </div>
    </ActivePortfolioProvider>
  );
}

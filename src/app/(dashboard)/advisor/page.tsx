import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, portfolios } from "@/db/schema";
import { eq } from "drizzle-orm";
import PortfolioBuilderWizard from "@/components/builder/PortfolioBuilderWizard";

export default async function AdvisorPage() {
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

  if (userPortfolios.length === 0) redirect("/onboarding");

  return (
    <div className="max-w-2xl mx-auto">
      <PortfolioBuilderWizard portfolios={userPortfolios.map((p) => ({
        id: p.id,
        name: p.name,
        cashBalance: parseFloat(p.cashBalance),
        isDefault: p.isDefault,
      }))} />
    </div>
  );
}

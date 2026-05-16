import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { portfolios, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import OnboardingFlow from "@/components/OnboardingFlow";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/");

  // Check if user already has a portfolio
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) redirect("/");

  const existing = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id))
    .limit(1);

  if (existing.length > 0) redirect("/dashboard");

  return <OnboardingFlow userId={dbUser[0].id} userName={dbUser[0].name} />;
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, portfolios, stockUniverse } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { buildAllocations } from "@/lib/suggest-utils";
export type { SuggestionItem } from "@/lib/suggest-utils";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const portfolioId = searchParams.get("portfolioId");
  const amount = parseFloat(searchParams.get("amount") ?? "0");
  const riskLevel = searchParams.get("riskLevel") as "low" | "medium" | "high" | null;
  const categoriesParam = searchParams.get("categories");
  const count = Math.min(parseInt(searchParams.get("count") ?? "5"), 20);

  if (!portfolioId) {
    return NextResponse.json({ error: "portfolioId is required" }, { status: 400 });
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  }
  if (!riskLevel || !["low", "medium", "high"].includes(riskLevel)) {
    return NextResponse.json({ error: "riskLevel must be low, medium, or high" }, { status: 400 });
  }

  // Verify portfolio belongs to user
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const portfolio = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, dbUser[0].id)))
    .limit(1);

  if (!portfolio[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const cashBalance = parseFloat(portfolio[0].cashBalance);
  if (amount > cashBalance) {
    return NextResponse.json(
      { error: `Insufficient cash. You have $${cashBalance.toFixed(2)} available.` },
      { status: 422 }
    );
  }

  // Build categories filter
  const categories = categoriesParam
    ? categoriesParam.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  // Query stock universe
  const conditions = [eq(stockUniverse.riskLevel, riskLevel)];

  let candidates = await db.select().from(stockUniverse).where(
    categories.length > 0
      ? and(...conditions, inArray(stockUniverse.category, categories))
      : conditions[0]
  );

  // Shuffle candidates
  candidates = candidates.sort(() => Math.random() - 0.5);

  // Pick `count` stocks
  const selected = candidates.slice(0, Math.max(count, 1));

  if (selected.length === 0) {
    return NextResponse.json({ error: "No stocks found for given parameters" }, { status: 404 });
  }

  // Get prices and build allocations
  const tickers = selected.map((s) => s.ticker);
  const allocations = await buildAllocations(tickers, selected, amount);

  return NextResponse.json({
    suggestions: allocations,
    cashBalance,
    investAmount: amount,
    riskLevel,
  });
}

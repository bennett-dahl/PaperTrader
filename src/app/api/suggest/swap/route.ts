import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, portfolios, stockUniverse, cachedQuotes } from "@/db/schema";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";
import { featureFlags } from "@/lib/featureFlags";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    portfolioId,
    tickerToReplace,
    excludeTickers,
    amount,
    riskLevel,
    categories,
    perStockAmount,
  } = body as {
    portfolioId: string;
    tickerToReplace: string;
    excludeTickers: string[];
    amount: number;
    riskLevel: "low" | "medium" | "high";
    categories: string[];
    perStockAmount: number;
  };

  if (!portfolioId || !tickerToReplace) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

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

  // Find a replacement stock from universe excluding current suggestions
  const allExclude = [...new Set([...(excludeTickers ?? []), tickerToReplace])];

  const conditions = [eq(stockUniverse.riskLevel, riskLevel)];
  const baseCondition =
    categories?.length > 0
      ? and(...conditions, inArray(stockUniverse.category, categories))
      : conditions[0];

  let candidates = await db
    .select()
    .from(stockUniverse)
    .where(
      allExclude.length > 0
        ? and(baseCondition, notInArray(stockUniverse.ticker, allExclude))
        : baseCondition
    );

  if (candidates.length === 0) {
    // Broaden search: drop category filter
    candidates = await db
      .select()
      .from(stockUniverse)
      .where(
        allExclude.length > 0
          ? and(eq(stockUniverse.riskLevel, riskLevel), notInArray(stockUniverse.ticker, allExclude))
          : eq(stockUniverse.riskLevel, riskLevel)
      );
  }

  if (candidates.length === 0) {
    return NextResponse.json({ error: "No replacement stocks available" }, { status: 404 });
  }

  // Pick a random one
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  // Get price
  const price = await getPrice(pick.ticker);
  if (!price || price <= 0) {
    return NextResponse.json({ error: "Could not fetch price for replacement stock" }, { status: 422 });
  }

  const allocAmt = perStockAmount ?? amount;
  const shares = Math.floor((allocAmt / price) * 10000) / 10000;

  return NextResponse.json({
    suggestion: {
      ticker: pick.ticker,
      name: pick.name,
      sector: pick.sector,
      category: pick.category,
      riskLevel: pick.riskLevel,
      marketCap: pick.marketCap,
      description: pick.description,
      price,
      shares,
      allocatedAmount: Math.round(shares * price * 100) / 100,
    },
  });
}

async function getPrice(ticker: string): Promise<number | null> {
  if (!featureFlags.SUGGEST_FORCE_FRESH_PRICES) {
    const STALE_THRESHOLD_MS = 5 * 60 * 1000;
    const cached = await db
      .select()
      .from(cachedQuotes)
      .where(eq(cachedQuotes.ticker, ticker))
      .limit(1);

    if (cached[0]) {
      const age = Date.now() - new Date(cached[0].updatedAt).getTime();
      if (age <= STALE_THRESHOLD_MS) {
        return parseFloat(cached[0].price);
      }
    }
  }

  try {
    const client = getFinnhubClient();
    const data = await fetchQuote(client, ticker);
    if (!data || !data.c) return null;

    await db
      .insert(cachedQuotes)
      .values({
        ticker,
        price: String(data.c),
        change: String(data.d ?? 0),
        changePercent: String(data.dp ?? 0),
      })
      .onConflictDoUpdate({
        target: cachedQuotes.ticker,
        set: {
          price: String(data.c),
          change: String(data.d ?? 0),
          changePercent: String(data.dp ?? 0),
          updatedAt: new Date(),
        },
      });

    return data.c;
  } catch {
    return null;
  }
}

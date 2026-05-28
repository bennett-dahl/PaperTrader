import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, portfolios, stockUniverse, cachedQuotes } from "@/db/schema";
import { eq, and, inArray, notInArray } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";
import { featureFlags } from "@/lib/featureFlags";

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

  // Get prices
  const tickers = selected.map((s) => s.ticker);
  const allocations = await buildAllocations(tickers, selected, amount);

  return NextResponse.json({
    suggestions: allocations,
    cashBalance,
    investAmount: amount,
    riskLevel,
  });
}

export interface SuggestionItem {
  ticker: string;
  name: string;
  sector: string;
  category: string;
  riskLevel: string;
  marketCap: string;
  description: string | null;
  price: number;
  shares: number;
  allocatedAmount: number;
}

async function buildAllocations(
  tickers: string[],
  stocks: { ticker: string; name: string; sector: string; category: string; riskLevel: string; marketCap: string; description: string | null }[],
  totalAmount: number
): Promise<SuggestionItem[]> {
  const perStock = totalAmount / stocks.length;
  const priceMap = await getPrices(tickers);

  const result: SuggestionItem[] = [];

  for (const stock of stocks) {
    const price = priceMap[stock.ticker];
    if (!price || price <= 0) continue;

    const shares = Math.floor((perStock / price) * 10000) / 10000; // truncate to 4 decimal places
    if (shares <= 0) continue;

    result.push({
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector,
      category: stock.category,
      riskLevel: stock.riskLevel,
      marketCap: stock.marketCap,
      description: stock.description,
      price,
      shares,
      allocatedAmount: Math.round(shares * price * 100) / 100,
    });
  }

  return result;
}

async function getPrices(tickers: string[]): Promise<Record<string, number>> {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000;
  const priceMap: Record<string, number> = {};

  if (!featureFlags.SUGGEST_FORCE_FRESH_PRICES) {
    const cached = await db
      .select()
      .from(cachedQuotes)
      .where(inArray(cachedQuotes.ticker, tickers));

    const now = Date.now();
    const staleTickers: string[] = [];

    for (const q of cached) {
      const age = now - new Date(q.updatedAt).getTime();
      if (age > STALE_THRESHOLD_MS) {
        staleTickers.push(q.ticker);
      } else {
        priceMap[q.ticker] = parseFloat(q.price);
      }
    }

    const missingTickers = tickers.filter((t) => !priceMap[t]);
    const toFetch = [...new Set([...missingTickers, ...staleTickers])];

    if (toFetch.length > 0) {
      await fetchAndCachePrices(toFetch, priceMap);
    }
  } else {
    await fetchAndCachePrices(tickers, priceMap);
  }

  return priceMap;
}

async function fetchAndCachePrices(
  tickers: string[],
  priceMap: Record<string, number>
) {
  const client = getFinnhubClient();

  await Promise.allSettled(
    tickers.map(async (ticker) => {
      try {
        const data = await fetchQuote(client, ticker);
        if (!data || !data.c) return;

        priceMap[ticker] = data.c;

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
      } catch (err) {
        console.error(`[suggest] Failed to fetch price for ${ticker}:`, err);
      }
    })
  );
}

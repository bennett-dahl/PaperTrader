import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, users, cachedQuotes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getFinnhubClient, fetchQuote } from "@/lib/finnhub";
import { executeTrade } from "@/lib/trade-executor";

export async function POST(req: NextRequest) {
  const pipelineSecret = req.headers.get("x-pipeline-secret");
  let isPipelineRequest = false;

  if (pipelineSecret !== null) {
    if (pipelineSecret !== process.env.PIPELINE_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    isPipelineRequest = true;
  }

  // Step 1: Auth gate — before body parse, before any DB calls
  let sessionEmail: string | null = null;
  if (!isPipelineRequest) {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    sessionEmail = session.user.email;
  }

  // Step 2: Parse and validate body fields
  const body = await req.json();
  const { ticker, type, shares, portfolioId } = body as {
    ticker: string;
    type: "BUY" | "SELL";
    shares: number;
    portfolioId: string;
    userId?: string;
  };

  if (!ticker || !type || !shares || !portfolioId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (shares <= 0) {
    return NextResponse.json({ error: "Shares must be positive" }, { status: 400 });
  }

  // Step 3: Resolve userId (DB lookup for session users; body field for pipeline)
  let authedUserId: string | null = null;

  if (!isPipelineRequest) {
    const dbUser = await db
      .select()
      .from(users)
      .where(eq(users.email, sessionEmail!))
      .limit(1);

    if (!dbUser[0]) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    authedUserId = dbUser[0].id;
  } else {
    authedUserId = body.userId ?? null;
    if (!authedUserId) {
      return NextResponse.json({ error: "userId required for pipeline requests" }, { status: 400 });
    }
  }

  // Portfolio ownership check
  const portfolio = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, authedUserId!)))
    .limit(1);

  if (!portfolio[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  // Get current price from cache
  let quote = await db
    .select()
    .from(cachedQuotes)
    .where(eq(cachedQuotes.ticker, ticker.toUpperCase()))
    .limit(1);

  // If no cached quote, fetch live from Finnhub
  if (!quote[0]) {
    try {
      const client = getFinnhubClient();
      const data = await fetchQuote(client, ticker.toUpperCase());

      if (data) {
        await db
          .insert(cachedQuotes)
          .values({
            ticker: ticker.toUpperCase(),
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

        quote = await db
          .select()
          .from(cachedQuotes)
          .where(eq(cachedQuotes.ticker, ticker.toUpperCase()))
          .limit(1);
      }
    } catch (err) {
      console.error("[trade] Finnhub fetch failed:", err);
    }
  }

  if (!quote[0]) {
    return NextResponse.json(
      { error: "No price data available for this ticker. Try again in a moment." },
      { status: 422 }
    );
  }

  const price = parseFloat(quote[0].price);

  const result = await executeTrade({
    portfolioId,
    ticker,
    type,
    shares,
    userId: authedUserId!,
    price, // pass pre-fetched price to avoid double lookup
  });

  if (!result.success) {
    const errMsg = result.error ?? "Trade failed";
    const status = errMsg === "Portfolio not found" ? 404 :
                   errMsg === "Unauthorized" ? 401 :
                   errMsg === "Trade failed" ? 500 : 422;
    return NextResponse.json({ error: errMsg }, { status });
  }

  return NextResponse.json({
    success: true,
    trade: {
      type,
      ticker: ticker.toUpperCase(),
      shares,
      pricePerShare: price,
      totalAmount: price * shares,
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cachedQuotes } from "@/db/schema";
import { eq } from "drizzle-orm";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function finnhubHeaders() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not set");
  return { "X-Finnhub-Token": key };
}

async function fetchCompanyProfile(ticker: string) {
  const res = await fetch(
    `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(ticker)}`,
    { headers: finnhubHeaders(), next: { revalidate: 60 } }
  );
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = await res.json();
  if (!d || !d.ticker) return null;
  return {
    name: d.name ?? null,
    exchange: d.exchange ?? null,
    currency: d.currency ?? null,
    logo: d.logo ?? null,
    weburl: d.weburl ?? null,
    ipo: d.ipo ?? null,
    finnhubIndustry: d.finnhubIndustry ?? null,
    country: d.country ?? null,
    marketCapitalization: d.marketCapitalization ?? null,
    shareOutstanding: d.shareOutstanding ?? null,
  };
}

async function fetchBasicFinancials(ticker: string) {
  const res = await fetch(
    `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=metric`,
    { headers: finnhubHeaders(), next: { revalidate: 60 } }
  );
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = await res.json();
  const m = d?.metric;
  if (!m) return null;
  return {
    peRatioTTM: m["peNormalizedAnnual"] ?? m["peTTM"] ?? null,
    pbRatioQuarterly: m["pb"] ?? null,
    epsTTM: m["epsTTM"] ?? null,
    dividendYieldIndicatedAnnual: m["dividendYieldIndicatedAnnual"] ?? null,
    revenuePerShareTTM: m["revenuePerShareTTM"] ?? null,
    roeTTM: m["roeTTM"] ?? null,
    debtToEquityQuarterly: m["totalDebt/totalEquityQuarterly"] ?? null,
    currentRatioQuarterly: m["currentRatioQuarterly"] ?? null,
    netProfitMarginTTM: m["netProfitMarginTTM"] ?? null,
    week52High: m["52WeekHigh"] ?? null,
    week52Low: m["52WeekLow"] ?? null,
    week52HighDate: m["52WeekHighDate"] ?? null,
    week52LowDate: m["52WeekLowDate"] ?? null,
    beta: m["beta"] ?? null,
  };
}

async function fetchCachedQuote(ticker: string) {
  const rows = await db
    .select()
    .from(cachedQuotes)
    .where(eq(cachedQuotes.ticker, ticker))
    .limit(1);
  const q = rows[0];
  if (!q) return null;
  return {
    currentPrice: parseFloat(q.price),
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    previousClose: null,
    change: parseFloat(q.change),
    changePercent: parseFloat(q.changePercent),
    timestamp: Math.floor(new Date(q.updatedAt).getTime() / 1000),
  };
}

async function fetchLiveQuote(ticker: string) {
  const res = await fetch(
    `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}`,
    { headers: finnhubHeaders(), next: { revalidate: 60 } }
  );
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d: any = await res.json();
  if (!d || !d.c) return null;
  return {
    currentPrice: d.c ?? null,
    openPrice: d.o ?? null,
    highPrice: d.h ?? null,
    lowPrice: d.l ?? null,
    previousClose: d.pc ?? null,
    change: d.d ?? null,
    changePercent: d.dp ?? null,
    timestamp: d.t ?? null,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const [profileResult, fundamentalsResult, quoteResult, cachedQuoteResult] =
    await Promise.allSettled([
      fetchCompanyProfile(ticker),
      fetchBasicFinancials(ticker),
      fetchLiveQuote(ticker),
      fetchCachedQuote(ticker),
    ]);

  const profile =
    profileResult.status === "fulfilled" ? profileResult.value : null;
  const fundamentals =
    fundamentalsResult.status === "fulfilled" ? fundamentalsResult.value : null;
  const liveQuote =
    quoteResult.status === "fulfilled" ? quoteResult.value : null;
  const cachedQuote =
    cachedQuoteResult.status === "fulfilled" ? cachedQuoteResult.value : null;

  // Prefer live quote data; fall back to cached for price/change fields
  const quote = liveQuote ?? (cachedQuote ? {
    currentPrice: cachedQuote.currentPrice,
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    previousClose: null,
    change: cachedQuote.change,
    changePercent: cachedQuote.changePercent,
    timestamp: cachedQuote.timestamp,
  } : null);

  // If all three primary sources failed
  if (!profile && !fundamentals && !quote) {
    return NextResponse.json(
      { error: "Data temporarily unavailable" },
      { status: 503 }
    );
  }

  // If profile returned but is empty (ticker not found), return 404
  if (profileResult.status === "fulfilled" && profileResult.value === null && !fundamentals && !quote) {
    return NextResponse.json({ error: "Ticker not found" }, { status: 404 });
  }

  // Update cachedQuotes.name if we got a company name from profile
  if (profile?.name) {
    try {
      await db
        .insert(cachedQuotes)
        .values({
          ticker,
          name: profile.name,
          price: String(quote?.currentPrice ?? 0),
          change: String(quote?.change ?? 0),
          changePercent: String(quote?.changePercent ?? 0),
        })
        .onConflictDoUpdate({
          target: cachedQuotes.ticker,
          set: {
            name: profile.name,
            ...(liveQuote
              ? {
                  price: String(liveQuote.currentPrice ?? 0),
                  change: String(liveQuote.change ?? 0),
                  changePercent: String(liveQuote.changePercent ?? 0),
                  updatedAt: new Date(),
                }
              : {}),
          },
        });
    } catch (err) {
      console.error("[stock-detail] Failed to update cachedQuotes:", err);
    }
  }

  return NextResponse.json({
    ticker,
    profile,
    fundamentals,
    quote,
    fetchedAt: Date.now(),
  });
}

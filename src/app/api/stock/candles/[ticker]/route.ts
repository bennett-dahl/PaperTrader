import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";

interface CandlePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Returns ET UTC offset as hours (e.g. -5 for EST, -4 for EDT). */
function getETOffsetHours(date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const etStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  const utcDate = new Date(utcStr);
  const etDate = new Date(etStr);
  return (etDate.getTime() - utcDate.getTime()) / 3600000;
}

/** Get today's 09:30 ET as a Date object. */
function getTodayMarketOpenDate(): Date {
  const now = new Date();
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  });
  const parts = etFormatter.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const etOffset = getETOffsetHours(now);
  return new Date(Date.UTC(year, month - 1, day, 9 - etOffset, 30));
}

/** Get previous trading day market open as a Date. */
function getPreviousTradingDayOpenDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() - 2); // Sunday → Friday
  if (dow === 6) d.setDate(d.getDate() - 1); // Saturday → Friday
  const etOffset = getETOffsetHours(d);
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 9 - etOffset, 30)
  );
}

type YFInterval = "5m" | "1h" | "1d";

const TIMEFRAME_CONFIG: Record<
  Timeframe,
  {
    resolution: string;
    interval: YFInterval;
    fromFn: () => Date;
  }
> = {
  "1D": {
    resolution: "5",
    interval: "5m",
    fromFn: () => {
      const marketOpen = getTodayMarketOpenDate();
      const now = new Date();
      const dayOfWeek = now.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6 || now < marketOpen) {
        return getPreviousTradingDayOpenDate();
      }
      return marketOpen;
    },
  },
  "1W": {
    resolution: "60",
    interval: "1h",
    fromFn: () => new Date(Date.now() - 7 * 86400 * 1000),
  },
  "1M": {
    resolution: "D",
    interval: "1d",
    fromFn: () => new Date(Date.now() - 30 * 86400 * 1000),
  },
  "3M": {
    resolution: "D",
    interval: "1d",
    fromFn: () => new Date(Date.now() - 90 * 86400 * 1000),
  },
  "1Y": {
    resolution: "D",
    interval: "1d",
    fromFn: () => new Date(Date.now() - 365 * 86400 * 1000),
  },
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const { searchParams } = new URL(req.url);
  const timeframe = searchParams.get("timeframe") as Timeframe | null;

  if (!timeframe || !TIMEFRAME_CONFIG[timeframe]) {
    return NextResponse.json({ error: "Invalid timeframe param" }, { status: 400 });
  }

  const config = TIMEFRAME_CONFIG[timeframe];
  const fromDate = config.fromFn();
  const toDate = new Date();
  const fromSec = Math.floor(fromDate.getTime() / 1000);
  const toSec = Math.floor(toDate.getTime() / 1000);

  let candles: CandlePoint[] = [];
  let noData = false;

  try {
    const result = await yahooFinance.chart(ticker, {
      period1: fromDate,
      period2: toDate,
      interval: config.interval,
      return: "array",
    });

    const quotes = result.quotes ?? [];

    if (quotes.length === 0) {
      noData = true;
    } else {
      candles = quotes
        .filter(
          (q) =>
            q.open != null &&
            q.high != null &&
            q.low != null &&
            q.close != null
        )
        .map((q) => ({
          timestamp: new Date(q.date).getTime(),
          open: q.open as number,
          high: q.high as number,
          low: q.low as number,
          close: q.close as number,
          volume: q.volume ?? 0,
        }));

      if (candles.length === 0) noData = true;
    }
  } catch (err) {
    console.error("[candles] yahoo-finance2 error:", err);
    return NextResponse.json(
      { error: "Failed to fetch candle data" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ticker,
    timeframe,
    resolution: config.resolution,
    candles,
    noData,
    from: fromSec,
    to: toSec,
  });
}

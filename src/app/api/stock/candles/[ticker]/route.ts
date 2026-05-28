import { NextRequest, NextResponse } from "next/server";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";

interface CandlePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FinnhubCandleResponse {
  s: string;
  c?: number[];
  h?: number[];
  l?: number[];
  o?: number[];
  t?: number[];
  v?: number[];
}

function finnhubHeaders() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not set");
  return { "X-Finnhub-Token": key };
}

/** Get previous trading day (skips weekends). */
function getPreviousTradingDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() - 2); // Sunday → Friday
  if (dow === 6) d.setDate(d.getDate() - 1); // Saturday → Friday
  return d;
}

/** Get today's 09:30 ET as Unix seconds. ET = UTC-5 (EST) or UTC-4 (EDT). */
function getTodayMarketOpen(): number {
  const now = new Date();
  // Use Intl to get ET offset
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = etFormatter.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0");

  const year = get("year");
  const month = get("month");
  const day = get("day");

  // Construct ET 09:30 as a UTC date
  const etOpenStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T09:30:00`;
  const etDate = new Date(etOpenStr + " ET"); // won't work directly

  // Better approach: construct the date in ET by finding offset
  // Create a date for today at 09:30 ET
  const todayAtMarketOpenET = new Date(
    Date.UTC(year, month - 1, day, 9 + 5, 30) // approximate UTC-5
  );

  // Adjust for actual ET offset by checking DST
  const etOffset = getETOffsetHours(now);
  const marketOpenUTC = new Date(Date.UTC(year, month - 1, day, 9 - etOffset, 30));

  return Math.floor(marketOpenUTC.getTime() / 1000);
}

/** Returns ET UTC offset as hours (e.g. -5 for EST, -4 for EDT). */
function getETOffsetHours(date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const etStr = date.toLocaleString("en-US", { timeZone: "America/New_York" });
  const utcDate = new Date(utcStr);
  const etDate = new Date(etStr);
  return (etDate.getTime() - utcDate.getTime()) / 3600000;
}

function transformFinnhubCandles(raw: FinnhubCandleResponse): CandlePoint[] {
  if (raw.s !== "ok" || !raw.t) return [];
  return raw.t.map((timestamp, i) => ({
    timestamp: timestamp * 1000,
    open: raw.o?.[i] ?? 0,
    high: raw.h?.[i] ?? 0,
    low: raw.l?.[i] ?? 0,
    close: raw.c?.[i] ?? 0,
    volume: raw.v?.[i] ?? 0,
  }));
}

const TIMEFRAME_CONFIG: Record<
  Timeframe,
  { resolution: string; cacheTtl: number; fromFn: (now: number) => number }
> = {
  "1D": {
    resolution: "5",
    cacheTtl: 60,
    fromFn: (_now) => {
      const marketOpen = getTodayMarketOpen();
      const nowSec = Math.floor(Date.now() / 1000);
      // If before today's market open or weekend, use previous trading day
      const dayOfWeek = new Date().getDay();
      if (
        dayOfWeek === 0 ||
        dayOfWeek === 6 ||
        nowSec < marketOpen
      ) {
        const prevDay = getPreviousTradingDay(new Date());
        const etOffset = getETOffsetHours(prevDay);
        return Math.floor(
          new Date(
            Date.UTC(
              prevDay.getFullYear(),
              prevDay.getMonth(),
              prevDay.getDate(),
              9 - etOffset,
              30
            )
          ).getTime() / 1000
        );
      }
      return marketOpen;
    },
  },
  "1W": { resolution: "60", cacheTtl: 300, fromFn: (now) => now - 7 * 86400 },
  "1M": { resolution: "D", cacheTtl: 3600, fromFn: (now) => now - 30 * 86400 },
  "3M": { resolution: "D", cacheTtl: 3600, fromFn: (now) => now - 90 * 86400 },
  "1Y": { resolution: "D", cacheTtl: 86400, fromFn: (now) => now - 365 * 86400 },
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const { searchParams } = new URL(req.url);
  const timeframe = searchParams.get("timeframe") as Timeframe | null;

  if (!timeframe || !TIMEFRAME_CONFIG[timeframe]) {
    return NextResponse.json({ error: "Invalid timeframe param" }, { status: 400 });
  }

  const config = TIMEFRAME_CONFIG[timeframe];
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = config.fromFn(nowSec);

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const url = `${FINNHUB_BASE}/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=${config.resolution}&from=${fromSec}&to=${nowSec}`;

  let rawData: FinnhubCandleResponse;
  try {
    const res = await fetch(url, {
      headers: { "X-Finnhub-Token": apiKey },
      next: { revalidate: config.cacheTtl },
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream API error" }, { status: 502 });
    }
    rawData = (await res.json()) as FinnhubCandleResponse;
  } catch {
    return NextResponse.json({ error: "Failed to fetch candle data" }, { status: 502 });
  }

  if (rawData.s === "no_data" || rawData.s !== "ok") {
    return NextResponse.json({
      ticker,
      timeframe,
      resolution: config.resolution,
      candles: [],
      noData: true,
      from: fromSec,
      to: nowSec,
    });
  }

  const candles = transformFinnhubCandles(rawData);

  return NextResponse.json({
    ticker,
    timeframe,
    resolution: config.resolution,
    candles,
    noData: false,
    from: fromSec,
    to: nowSec,
  });
}

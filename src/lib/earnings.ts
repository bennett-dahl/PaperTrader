import { getFinnhubClient } from "./finnhub";
import yahooFinance from "yahoo-finance2";
import { db } from "@/db";
import { earningsSignals } from "@/db/schema";
import { and, gte, lte, inArray } from "drizzle-orm";

export interface EarningsSignal {
  ticker: string;
  reportDate: string;
  reportTime: string | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsBeat: boolean | null;
  epsSurprisePct: number | null;
  analystRevisionDirection: string | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueBeat: boolean | null;
}

/**
 * Fetch earnings signals for a list of tickers.
 * Checks DB cache first; calls Finnhub only for misses.
 * Rate-limit safe: 200ms delay between Finnhub calls (enforces <60/min).
 */
export async function fetchEarningsSignals(
  tickers: string[],
  lookbackDays: number,
  forwardDays: number
): Promise<Map<string, EarningsSignal>> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - lookbackDays * 86400000);
  const toDate = new Date(now.getTime() + forwardDays * 86400000);
  const fromStr = toDateStr(fromDate);
  const toStr = toDateStr(toDate);

  const result = new Map<string, EarningsSignal>();

  if (tickers.length === 0) return result;

  // Batch cache lookup — single query instead of per-ticker SELECTs
  const cachedRows = await db
    .select()
    .from(earningsSignals)
    .where(
      and(
        inArray(earningsSignals.ticker, tickers),
        gte(earningsSignals.reportDate, fromStr),
        lte(earningsSignals.reportDate, toStr),
        gte(earningsSignals.expiresAt, now)
      )
    );

  const cachedTickers = new Set<string>();
  for (const row of cachedRows) {
    result.set(row.ticker, mapRow(row));
    cachedTickers.add(row.ticker);
  }

  const cacheMisses = tickers.filter((t) => !cachedTickers.has(t));

  const client = getFinnhubClient();
  for (const ticker of cacheMisses) {
    try {
      const data = await fetchFinnhubEarnings(client, ticker, fromStr, toStr);
      if (data) {
        // Enrich with analyst revision direction from yahoo-finance2
        data.analystRevisionDirection = await fetchAnalystRevisionDirection(ticker);
        await upsertEarningsSignal(ticker, data);
        result.set(ticker, data);
      }
      await sleep(200); // Respect 60/min rate limit
    } catch (err) {
      console.error(`[earnings] Failed to fetch ${ticker}:`, err);
    }
  }

  return result;
}

export function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchFinnhubEarnings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ticker: string,
  from: string,
  to: string
): Promise<EarningsSignal | null> {
  return new Promise((resolve) => {
    client.earningsCalendar(
      { from, to, symbol: ticker, international: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (error: unknown, data: any) => {
        if (error || !data?.earningsCalendar?.length) {
          resolve(null);
          return;
        }
        const e = data.earningsCalendar[0];
        const epsActual = e.epsActual ?? null;
        const epsEstimate = e.epsEstimate ?? null;
        const epsBeat =
          epsActual !== null && epsEstimate !== null ? epsActual >= epsEstimate : null;
        const epsSurprisePct =
          epsBeat !== null && epsEstimate !== 0 && epsEstimate !== null
            ? ((epsActual! - epsEstimate!) / Math.abs(epsEstimate!)) * 100
            : null;

        resolve({
          ticker,
          reportDate: e.date,
          reportTime: e.hour ?? null,
          epsActual,
          epsEstimate,
          epsBeat,
          epsSurprisePct,
          analystRevisionDirection: null,
          revenueActual: e.revenueActual ?? null,
          revenueEstimate: e.revenueEstimate ?? null,
          revenueBeat:
            e.revenueActual !== null && e.revenueEstimate !== null
              ? e.revenueActual >= e.revenueEstimate
              : null,
        });
      }
    );
  });
}

/**
 * Determine analyst revision direction for a ticker using yahoo-finance2.
 * Counts upgrades vs downgrades over the last 30 days and returns 'up' | 'down' | 'neutral'.
 */
export async function fetchAnalystRevisionDirection(ticker: string): Promise<"up" | "down" | "neutral"> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await yahooFinance.quoteSummary(ticker, {
      modules: ["upgradeDowngradeHistory"],
    });
    const history = result.upgradeDowngradeHistory?.history ?? [];
    const cutoff = Date.now() - 30 * 86400000;
    const recent = history.filter((item: { epochGradeDate: number }) => item.epochGradeDate * 1000 >= cutoff);
    let upgrades = 0;
    let downgrades = 0;
    for (const item of recent) {
      const action = (item.action ?? "").toLowerCase();
      if (action === "up" || action === "upgrade") upgrades++;
      else if (action === "down" || action === "downgrade") downgrades++;
    }
    if (upgrades > downgrades) return "up";
    if (downgrades > upgrades) return "down";
    return "neutral";
  } catch {
    return "neutral";
  }
}

export async function upsertEarningsSignal(ticker: string, signal: EarningsSignal): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  await db
    .insert(earningsSignals)
    .values({
      ticker: signal.ticker,
      reportDate: signal.reportDate,
      reportTime: signal.reportTime,
      epsActual: signal.epsActual !== null ? String(signal.epsActual) : null,
      epsEstimate: signal.epsEstimate !== null ? String(signal.epsEstimate) : null,
      epsBeat: signal.epsBeat,
      epsSurprisePct: signal.epsSurprisePct !== null ? String(signal.epsSurprisePct) : null,
      analystRevisionDirection: signal.analystRevisionDirection,
      revenueActual: signal.revenueActual !== null ? String(signal.revenueActual) : null,
      revenueEstimate: signal.revenueEstimate !== null ? String(signal.revenueEstimate) : null,
      revenueBeat: signal.revenueBeat,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [earningsSignals.ticker, earningsSignals.reportDate],
      set: {
        epsActual: signal.epsActual !== null ? String(signal.epsActual) : null,
        epsEstimate: signal.epsEstimate !== null ? String(signal.epsEstimate) : null,
        epsBeat: signal.epsBeat,
        epsSurprisePct: signal.epsSurprisePct !== null ? String(signal.epsSurprisePct) : null,
        analystRevisionDirection: signal.analystRevisionDirection,
        revenueActual: signal.revenueActual !== null ? String(signal.revenueActual) : null,
        revenueEstimate: signal.revenueEstimate !== null ? String(signal.revenueEstimate) : null,
        revenueBeat: signal.revenueBeat,
        reportTime: signal.reportTime,
        fetchedAt: new Date(),
        expiresAt,
      },
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRow(row: any): EarningsSignal {
  return {
    ticker: row.ticker,
    reportDate: row.reportDate,
    reportTime: row.reportTime,
    epsActual: row.epsActual !== null ? parseFloat(row.epsActual) : null,
    epsEstimate: row.epsEstimate !== null ? parseFloat(row.epsEstimate) : null,
    epsBeat: row.epsBeat,
    epsSurprisePct: row.epsSurprisePct !== null ? parseFloat(row.epsSurprisePct) : null,
    analystRevisionDirection: row.analystRevisionDirection,
    revenueActual: row.revenueActual !== null ? parseFloat(row.revenueActual) : null,
    revenueEstimate: row.revenueEstimate !== null ? parseFloat(row.revenueEstimate) : null,
    revenueBeat: row.revenueBeat,
  };
}

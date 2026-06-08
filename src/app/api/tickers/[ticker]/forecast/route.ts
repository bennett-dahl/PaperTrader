import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { kronosForecasts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const row = await db
    .select({
      ticker: kronosForecasts.ticker,
      predictedReturnPct: kronosForecasts.predictedReturnPct,
      forecastDate: kronosForecasts.forecastDate,
      pipelineId: kronosForecasts.pipelineId,
    })
    .from(kronosForecasts)
    .where(eq(kronosForecasts.ticker, ticker))
    .orderBy(desc(kronosForecasts.forecastDate))
    .limit(1);

  if (row.length === 0) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    ticker: row[0].ticker,
    predictedReturnPct: parseFloat(row[0].predictedReturnPct),
    forecastDate: row[0].forecastDate,
    pipelineId: row[0].pipelineId,
  });
}

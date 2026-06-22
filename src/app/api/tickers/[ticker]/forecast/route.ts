import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { kronosForecasts, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify user exists in DB
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);
  if (userRows.length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

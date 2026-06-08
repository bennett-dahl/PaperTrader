import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { kronosForecasts, pipelineRuns, pipelines } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const { id: pipelineId, runId } = await params;

  // Get the run to find forecastDate
  const runs = await db
    .select({ startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.id, runId))
    .limit(1);

  if (runs.length === 0) {
    return NextResponse.json({ forecasts: [], kronosMinSignalPct: 1.0 });
  }

  const forecastDate = runs[0].startedAt.toISOString().split("T")[0];

  // Get pipeline's minSignalPct
  const pipelineRows = await db
    .select({ kronosMinSignalPct: pipelines.kronosMinSignalPct })
    .from(pipelines)
    .where(eq(pipelines.id, pipelineId))
    .limit(1);

  const kronosMinSignalPct = parseFloat(
    pipelineRows[0]?.kronosMinSignalPct ?? "1.00"
  );

  const rows = await db
    .select({
      ticker: kronosForecasts.ticker,
      predictedReturnPct: kronosForecasts.predictedReturnPct,
      forecastDate: kronosForecasts.forecastDate,
    })
    .from(kronosForecasts)
    .where(
      and(
        eq(kronosForecasts.pipelineId, pipelineId),
        eq(kronosForecasts.forecastDate, forecastDate)
      )
    );

  const forecasts = rows
    .map((r) => {
      const pct = parseFloat(r.predictedReturnPct);
      const signal: "buy" | "sell" | "hold" =
        pct > kronosMinSignalPct
          ? "buy"
          : pct < -kronosMinSignalPct
          ? "sell"
          : "hold";
      return {
        ticker: r.ticker,
        predictedReturnPct: pct,
        forecastDate: r.forecastDate,
        signal,
      };
    })
    .sort((a, b) => b.predictedReturnPct - a.predictedReturnPct);

  return NextResponse.json({ forecasts, kronosMinSignalPct });
}

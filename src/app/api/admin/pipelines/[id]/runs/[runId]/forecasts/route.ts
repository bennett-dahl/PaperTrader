import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns, kronosForecasts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdminUser } from "../../../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: pipelineId, runId } = await params;

  const [pipeline] = await db
    .select({ kronosMinSignalPct: pipelines.kronosMinSignalPct })
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const [run] = await db
    .select({ startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, pipelineId)))
    .limit(1);

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const forecastDate = run.startedAt.toISOString().split("T")[0];
  const kronosMinSignalPct = parseFloat(pipeline.kronosMinSignalPct ?? "1.00");

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
        pct > kronosMinSignalPct ? "buy" : pct < -kronosMinSignalPct ? "sell" : "hold";
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

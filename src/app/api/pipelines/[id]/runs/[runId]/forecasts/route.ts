import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { kronosForecasts, pipelineRuns, pipelines, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function getAuthUser() {
  const session = await auth();
  if (!session?.user?.email) return null;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: pipelineId, runId } = await params;

  // Verify pipeline belongs to this user
  const pipelineRows = await db
    .select({ kronosMinSignalPct: pipelines.kronosMinSignalPct })
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, user.id)))
    .limit(1);

  if (pipelineRows.length === 0) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  // Get the run to find forecastDate (also verify it belongs to this pipeline)
  const runs = await db
    .select({ startedAt: pipelineRuns.startedAt })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, pipelineId)))
    .limit(1);

  if (runs.length === 0) {
    return NextResponse.json({ forecasts: [], kronosMinSignalPct: 1.0 });
  }

  const forecastDate = runs[0].startedAt.toISOString().split("T")[0];
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

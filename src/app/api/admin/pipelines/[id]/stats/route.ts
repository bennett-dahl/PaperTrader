import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns } from "@/db/schema";
import { eq, and, count, sum, desc } from "drizzle-orm";
import { requireAdminUser } from "../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Check pipeline belongs to admin user
  const existing = await db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!existing[0]) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  // Aggregate stats
  const [agg] = await db
    .select({
      totalRuns: count(pipelineRuns.id),
      totalInputTokens: sum(pipelineRuns.inputTokens),
      totalOutputTokens: sum(pipelineRuns.outputTokens),
      totalCostUsd: sum(pipelineRuns.costUsd),
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id));

  // Count by status
  const allRuns = await db
    .select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      durationMs: pipelineRuns.durationMs,
      tradesExecuted: pipelineRuns.tradesExecuted,
      inputTokens: pipelineRuns.inputTokens,
      outputTokens: pipelineRuns.outputTokens,
      costUsd: pipelineRuns.costUsd,
    })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(20);

  const completedRuns = allRuns.filter((r) => r.status === "completed").length;
  const failedRuns = allRuns.filter((r) => r.status === "failed").length;
  const totalTradesExecuted = allRuns.reduce((s, r) => s + (r.tradesExecuted ?? 0), 0);

  const summary = {
    totalRuns: agg?.totalRuns ?? 0,
    completedRuns,
    failedRuns,
    totalTradesExecuted,
    totalInputTokens: Number(agg?.totalInputTokens ?? 0),
    totalOutputTokens: Number(agg?.totalOutputTokens ?? 0),
    totalCostUsd: agg?.totalCostUsd ?? "0",
  };

  const recentRuns = allRuns.map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    durationMs: r.durationMs,
    tradesExecuted: r.tradesExecuted,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
  }));

  return NextResponse.json({
    pipeline: { id: existing[0].id, name: existing[0].name },
    summary,
    recentRuns,
  });
}

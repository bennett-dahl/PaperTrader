import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns, decisionLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdminUser } from "../../../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, runId } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const [run] = await db
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.pipelineId, id)))
    .limit(1);

  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const decisions = await db
    .select()
    .from(decisionLog)
    .where(eq(decisionLog.runId, runId));

  return NextResponse.json({ decisions, run });
}

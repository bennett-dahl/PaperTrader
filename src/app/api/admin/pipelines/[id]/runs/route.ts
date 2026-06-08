import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, pipelineRuns } from "@/db/schema";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAdminUser } from "../../../_auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "20");
  const offset = parseInt(url.searchParams.get("offset") ?? "0");

  const [totalRow] = await db
    .select({ count: count() })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id));

  const runs = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(limit)
    .offset(offset);

  return NextResponse.json({ runs, total: Number(totalRow.count) });
}

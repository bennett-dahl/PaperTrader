import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { Client as QStashClient } from "@upstash/qstash";
import { requireAdminUser } from "../../../_auth";

export async function POST(
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

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
  // Use VERCEL_PROJECT_PRODUCTION_URL (production alias) so QStash can reach
  // the endpoint without Vercel Deployment Protection blocking per-deployment URLs.
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXTAUTH_URL ?? `https://${process.env.VERCEL_URL}`;

  await qstash.publishJSON({
    url: `${baseUrl}/api/pipeline/run`,
    body: { pipelineId: pipeline.id, triggeredBy: "manual" },
    headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET! },
    retries: 1,
    deduplicationId: `pipeline-manual-${pipeline.id}-${Date.now()}`,
  });

  return NextResponse.json({ queued: true, pipelineId: pipeline.id }, { status: 202 });
}

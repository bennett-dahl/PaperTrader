import { NextRequest, NextResponse } from "next/server";
import { Client as QStashClient } from "@upstash/qstash";
import { db } from "@/db";
import { pipelines } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activePipelines = await db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(eq(pipelines.status, "active"));

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXTAUTH_URL!;

  const dispatched: string[] = [];
  const failed: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const pipeline of activePipelines) {
    try {
      await qstash.publishJSON({
        url: `${baseUrl}/api/pipeline/run`,
        body: { pipelineId: pipeline.id, triggeredBy: "cron" },
        headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET! },
        retries: 2,
        deduplicationId: `pipeline-run-${pipeline.id}-${today}`,
      });
      dispatched.push(pipeline.id);
    } catch (err) {
      console.error(`[orchestrator] Failed to dispatch ${pipeline.id}:`, err);
      failed.push(pipeline.id);
    }
  }

  return NextResponse.json({ dispatched: dispatched.length, failed: failed.length });
}

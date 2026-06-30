import { NextRequest, NextResponse } from "next/server";
import { Client as QStashClient } from "@upstash/qstash";
import { db } from "@/db";
import { pipelines } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runKronosPrefetch } from "@/lib/run-kronos-prefetch";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Step 1: Prefetch Kronos forecasts before dispatching pipeline runs.
  // Errors are non-fatal — pipelines fall back to earnings-only signals.
  let kronosPrefetch = { upserted: 0, skipped: 0, errors: 0 };
  try {
    const result = await runKronosPrefetch();
    kronosPrefetch = {
      upserted: result.upserted,
      skipped: result.skipped,
      errors: result.errors.length,
    };
    console.log("[orchestrator] Kronos prefetch complete:", result);
  } catch (err) {
    console.error("[orchestrator] Kronos prefetch failed (continuing):", err);
  }

  // Step 2: Dispatch all active pipeline runs via QStash
  const activePipelines = await db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(eq(pipelines.status, "active"));

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
  // Use production URL to bypass per-deployment Vercel Protection
  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXTAUTH_URL ?? `https://${process.env.VERCEL_URL}`;

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

  return NextResponse.json({
    dispatched: dispatched.length,
    failed: failed.length,
    kronosPrefetch,
  });
}

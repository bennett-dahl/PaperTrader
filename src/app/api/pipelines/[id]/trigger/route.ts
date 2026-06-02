import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pipelines, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { Client as QStashClient } from "@upstash/qstash";

async function getAuthUser(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return null;
  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  return dbUser[0] ?? null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const qstash = new QStashClient({ token: process.env.QSTASH_TOKEN! });
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXTAUTH_URL!;

  await qstash.publishJSON({
    url: `${baseUrl}/api/pipeline/run`,
    body: { pipelineId: pipeline.id, triggeredBy: "manual" },
    headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET! },
    retries: 1,
    deduplicationId: `pipeline-manual-${pipeline.id}-${Date.now()}`,
  });

  return NextResponse.json({ queued: true, pipelineId: pipeline.id }, { status: 202 });
}

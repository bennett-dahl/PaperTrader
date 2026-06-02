import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  pipelines, strategyTemplates, pipelinePortfolios, pipelineRuns,
  users, portfolios
} from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { resolveConfig } from "@/lib/pipeline-config";

async function getAuthUser(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return null;
  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  return dbUser[0] ?? null;
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allPipelines = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.userId, user.id))
    .orderBy(desc(pipelines.createdAt));

  // Enrich with portfolio count and last run status
  const enriched = await Promise.all(allPipelines.map(async (p) => {
    const portfolioLinks = await db
      .select({ portfolioId: pipelinePortfolios.portfolioId })
      .from(pipelinePortfolios)
      .where(eq(pipelinePortfolios.pipelineId, p.id));

    const lastRun = await db
      .select({ status: pipelineRuns.status, startedAt: pipelineRuns.startedAt })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineId, p.id))
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(1);

    return {
      ...p,
      portfolioCount: portfolioLinks.length,
      lastRunStatus: lastRun[0]?.status ?? null,
      lastRunAt: lastRun[0]?.startedAt?.toISOString() ?? null,
    };
  }));

  return NextResponse.json({ pipelines: enriched });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, templateId, portfolioAssignments } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Load template if provided
  let template = null;
  if (templateId) {
    const rows = await db
      .select()
      .from(strategyTemplates)
      .where(and(eq(strategyTemplates.id, templateId), eq(strategyTemplates.userId, user.id)))
      .limit(1);
    template = rows[0] ?? null;
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  if (!body.thesis && !template?.thesis) {
    return NextResponse.json({ error: "thesis is required" }, { status: 400 });
  }

  const userInput: Record<string, unknown> = {};
  const inputFields = ["thesis", "strategyType", "tickerUniverse", "maxPositions",
    "maxPositionPct", "minCashReservePct", "earningsLookbackDays", "earningsForwardDays",
    "minConfidenceThreshold", "autonomous", "allowShortSell", "rebalanceOnRun", "hypothesisConfig"];

  for (const f of inputFields) {
    if (f in body && body[f] !== undefined) userInput[f] = body[f];
  }

  const { resolved, overrides } = resolveConfig(template, userInput as Parameters<typeof resolveConfig>[1]);

  const [pipeline] = await db
    .insert(pipelines)
    .values({
      userId: user.id,
      templateId: templateId ?? null,
      name,
      thesis: resolved.thesis as string,
      strategyType: resolved.strategyType,
      tickerUniverse: resolved.tickerUniverse,
      maxPositions: resolved.maxPositions,
      maxPositionPct: String(resolved.maxPositionPct),
      minCashReservePct: String(resolved.minCashReservePct),
      earningsLookbackDays: resolved.earningsLookbackDays,
      earningsForwardDays: resolved.earningsForwardDays,
      minConfidenceThreshold: String(resolved.minConfidenceThreshold),
      autonomous: resolved.autonomous,
      allowShortSell: resolved.allowShortSell,
      rebalanceOnRun: resolved.rebalanceOnRun,
      hypothesisConfig: resolved.hypothesisConfig,
      configOverrides: overrides,
    })
    .returning();

  // Create portfolio assignments
  if (portfolioAssignments?.length > 0) {
    for (const assignment of portfolioAssignments) {
      // Verify portfolio belongs to user
      const portfolioRow = await db.select().from(portfolios)
        .where(and(eq(portfolios.id, assignment.portfolioId), eq(portfolios.userId, user.id)))
        .limit(1);
      if (portfolioRow[0]) {
        await db.insert(pipelinePortfolios).values({
          pipelineId: pipeline.id,
          portfolioId: assignment.portfolioId,
          allocationPct: String(assignment.allocationPct ?? 100),
        }).onConflictDoNothing();
      }
    }
  }

  return NextResponse.json({ pipeline }, { status: 201 });
}

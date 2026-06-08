import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  pipelines, strategyTemplates, pipelinePortfolios, pipelineRuns, portfolios,
} from "@/db/schema";
import { eq, and, desc, count, sum } from "drizzle-orm";
import { resolveConfig } from "@/lib/pipeline-config";
import { requireAdminUser } from "../_auth";

export async function GET(req: NextRequest) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allPipelines = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.userId, user.id))
    .orderBy(desc(pipelines.createdAt));

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

    const [agg] = await db
      .select({
        totalRuns: count(pipelineRuns.id),
        totalInputTokens: sum(pipelineRuns.inputTokens),
        totalOutputTokens: sum(pipelineRuns.outputTokens),
        totalCostUsd: sum(pipelineRuns.costUsd),
      })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.pipelineId, p.id));

    return {
      id: p.id,
      name: p.name,
      status: p.status,
      strategyType: p.strategyType,
      thesis: p.thesis,
      createdAt: p.createdAt.toISOString(),
      portfolioCount: portfolioLinks.length,
      lastRunStatus: lastRun[0]?.status ?? null,
      lastRunAt: lastRun[0]?.startedAt?.toISOString() ?? null,
      totalRuns: agg?.totalRuns ?? 0,
      totalInputTokens: Number(agg?.totalInputTokens ?? 0),
      totalOutputTokens: Number(agg?.totalOutputTokens ?? 0),
      totalCostUsd: agg?.totalCostUsd ?? "0",
    };
  }));

  return NextResponse.json({ pipelines: enriched });
}

export async function POST(req: NextRequest) {
  const user = await requireAdminUser(req);
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
  const inputFields = [
    "thesis", "strategyType", "tickerUniverse", "maxPositions",
    "maxPositionPct", "minCashReservePct", "earningsLookbackDays", "earningsForwardDays",
    "minConfidenceThreshold", "autonomous", "allowShortSell", "rebalanceOnRun", "hypothesisConfig",
    "kronosTickerUniverse", "kronosRebalancePct", "kronosMinSignalPct",
  ];
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
      kronosTickerUniverse: (resolved.kronosTickerUniverse as string[]) ?? [],
      kronosRebalancePct: resolved.kronosRebalancePct ? String(resolved.kronosRebalancePct) : "50.00",
      kronosMinSignalPct: resolved.kronosMinSignalPct ? String(resolved.kronosMinSignalPct) : "1.00",
      configOverrides: overrides,
    })
    .returning();

  // Create portfolio assignments
  if (portfolioAssignments?.length > 0) {
    for (const assignment of portfolioAssignments) {
      const portfolioRow = await db
        .select()
        .from(portfolios)
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

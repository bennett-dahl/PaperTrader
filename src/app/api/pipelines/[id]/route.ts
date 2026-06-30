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

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let template = null;
  if (pipeline.templateId) {
    const rows = await db.select().from(strategyTemplates).where(eq(strategyTemplates.id, pipeline.templateId)).limit(1);
    template = rows[0] ?? null;
  }

  const portfolioLinks = await db
    .select({ link: pipelinePortfolios, portfolio: portfolios })
    .from(pipelinePortfolios)
    .innerJoin(portfolios, eq(portfolios.id, pipelinePortfolios.portfolioId))
    .where(eq(pipelinePortfolios.pipelineId, id));

  const recentRuns = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(10);

  return NextResponse.json({
    pipeline,
    template,
    portfolios: portfolioLinks.map(({ link, portfolio }) => ({
      portfolio,
      allocationPct: link.allocationPct,
    })),
    recentRuns,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();

  let template = null;
  const templateId = "templateId" in body ? body.templateId : pipeline.templateId;
  if (templateId) {
    const rows = await db.select().from(strategyTemplates)
      .where(and(eq(strategyTemplates.id, templateId), eq(strategyTemplates.userId, user.id)))
      .limit(1);
    template = rows[0] ?? null;
  }

  const userInput: Record<string, unknown> = {};
  const inputFields = [
    "thesis", "strategyType", "tickerUniverse",
    "maxPositions", "maxPositionPct", "minCashReservePct",
    "earningsLookbackDays", "earningsForwardDays",
    "minConfidenceThreshold", "autonomous", "allowShortSell",
    "rebalanceOnRun", "hypothesisConfig",
    "kronosTickerUniverse",
    "kronosMinSignalPct",
    "kronosMinTradePct", "kronosMaxTradePct", "kronosSaturationPct", "kronosSizingCurve",
  ];

  for (const f of inputFields) {
    if (f in body && body[f] !== undefined) userInput[f] = body[f];
    else if (f in pipeline) userInput[f] = (pipeline as Record<string, unknown>)[f];
  }

  const { resolved, overrides } = resolveConfig(template, userInput as Parameters<typeof resolveConfig>[1]);

  const updates: Record<string, unknown> = {
    templateId: templateId ?? null,
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
    kronosTickerUniverse: resolved.kronosTickerUniverse,
    kronosMinSignalPct:   String(resolved.kronosMinSignalPct),
    kronosMinTradePct:    String(resolved.kronosMinTradePct),
    kronosMaxTradePct:    String(resolved.kronosMaxTradePct),
    kronosSaturationPct:  String(resolved.kronosSaturationPct),
    kronosSizingCurve:    resolved.kronosSizingCurve,
    updatedAt: new Date(),
  };

  if ("name" in body) updates.name = body.name;
  if ("status" in body) updates.status = body.status;

  const [updatedPipeline] = await db
    .update(pipelines)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(updates as any)
    .where(eq(pipelines.id, id))
    .returning();

  return NextResponse.json({ pipeline: updatedPipeline });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const hasRuns = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.pipelineId, id))
    .limit(1);

  if (hasRuns[0]) {
    await db.update(pipelines).set({ status: "archived" }).where(eq(pipelines.id, id));
    return NextResponse.json({ archived: true });
  }

  await db.delete(pipelines).where(eq(pipelines.id, id));
  return NextResponse.json({ deleted: true });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { strategyTemplates, pipelines, users } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { INHERITABLE_FIELDS } from "@/lib/pipeline-defaults";

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

  const [template] = await db
    .select()
    .from(strategyTemplates)
    .where(and(eq(strategyTemplates.id, id), eq(strategyTemplates.userId, user.id)))
    .limit(1);

  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [existing] = await db
    .select()
    .from(strategyTemplates)
    .where(and(eq(strategyTemplates.id, id), eq(strategyTemplates.userId, user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  const fields = ["name", "description", "strategyType", "thesis", "tickerUniverse",
    "maxPositions", "maxPositionPct", "minCashReservePct", "earningsLookbackDays",
    "earningsForwardDays", "minConfidenceThreshold", "autonomous", "allowShortSell",
    "rebalanceOnRun", "hypothesisConfig"];

  for (const f of fields) {
    if (f in body && body[f] !== undefined) {
      if (f === "maxPositionPct" || f === "minCashReservePct" || f === "minConfidenceThreshold") {
        updates[f] = String(body[f]);
      } else {
        updates[f] = body[f];
      }
    }
  }

  const [updatedTemplate] = await db
    .update(strategyTemplates)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(updates as any)
    .where(eq(strategyTemplates.id, id))
    .returning();

  // Sync non-overridden fields to all linked pipelines
  const affectedPipelines = await db
    .select()
    .from(pipelines)
    .where(eq(pipelines.templateId, id));

  const updatedIds: string[] = [];
  for (const pipeline of affectedPipelines) {
    const nonOverriddenUpdates: Record<string, unknown> = {};
    for (const field of INHERITABLE_FIELDS) {
      if (!pipeline.configOverrides.includes(field)) {
        (nonOverriddenUpdates as Record<string, unknown>)[field] =
          (updatedTemplate as Record<string, unknown>)[field];
      }
    }
    if (Object.keys(nonOverriddenUpdates).length > 0) {
      await db.update(pipelines)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set({ ...nonOverriddenUpdates, updatedAt: new Date() } as any)
        .where(eq(pipelines.id, pipeline.id));
      updatedIds.push(pipeline.id);
    }
  }

  return NextResponse.json({ template: updatedTemplate, updatedPipelineIds: updatedIds });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const [existing] = await db
    .select()
    .from(strategyTemplates)
    .where(and(eq(strategyTemplates.id, id), eq(strategyTemplates.userId, user.id)))
    .limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Check for active pipelines
  const activePipelines = await db
    .select({ id: pipelines.id, name: pipelines.name })
    .from(pipelines)
    .where(and(eq(pipelines.templateId, id), ne(pipelines.status, "archived")));

  if (activePipelines.length > 0) {
    return NextResponse.json(
      { error: "Template is in use by active pipelines", pipelines: activePipelines },
      { status: 409 }
    );
  }

  await db.delete(strategyTemplates).where(eq(strategyTemplates.id, id));
  return NextResponse.json({ deleted: true });
}

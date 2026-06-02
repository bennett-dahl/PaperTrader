import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pipelines, pipelinePortfolios, portfolios, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function getAuthUser(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return null;
  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  return dbUser[0] ?? null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: pipelineId } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  const body = await req.json();
  const { portfolioId, allocationPct = 100 } = body;

  if (!portfolioId) {
    return NextResponse.json({ error: "portfolioId required" }, { status: 400 });
  }

  // Verify portfolio belongs to user
  const [portfolioRow] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, user.id)))
    .limit(1);

  if (!portfolioRow) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });

  // Check if already assigned to this pipeline
  const [existingLink] = await db
    .select()
    .from(pipelinePortfolios)
    .where(and(eq(pipelinePortfolios.pipelineId, pipelineId), eq(pipelinePortfolios.portfolioId, portfolioId)))
    .limit(1);

  if (existingLink) {
    return NextResponse.json({ error: "Portfolio already assigned to this pipeline" }, { status: 409 });
  }

  // Check if portfolio is assigned to another active pipeline
  const conflictingLinks = await db
    .select({ pipelineId: pipelinePortfolios.pipelineId })
    .from(pipelinePortfolios)
    .innerJoin(pipelines, eq(pipelines.id, pipelinePortfolios.pipelineId))
    .where(
      and(
        eq(pipelinePortfolios.portfolioId, portfolioId),
        eq(pipelines.status, "active")
      )
    );

  const conflicting = conflictingLinks.find((l) => l.pipelineId !== pipelineId);
  if (conflicting) {
    return NextResponse.json(
      { error: "Portfolio is already assigned to an active pipeline", conflictingPipelineId: conflicting.pipelineId },
      { status: 409 }
    );
  }

  const [link] = await db
    .insert(pipelinePortfolios)
    .values({ pipelineId, portfolioId, allocationPct: String(allocationPct) })
    .returning();

  return NextResponse.json({ link }, { status: 201 });
}

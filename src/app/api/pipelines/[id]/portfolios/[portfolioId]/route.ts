import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pipelines, pipelinePortfolios, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function getAuthUser(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return null;
  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  return dbUser[0] ?? null;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; portfolioId: string }> }
) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: pipelineId, portfolioId } = await params;

  const [pipeline] = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, pipelineId), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });

  await db
    .delete(pipelinePortfolios)
    .where(and(eq(pipelinePortfolios.pipelineId, pipelineId), eq(pipelinePortfolios.portfolioId, portfolioId)));

  return NextResponse.json({ deleted: true });
}

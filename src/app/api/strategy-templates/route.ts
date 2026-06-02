import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { strategyTemplates, users } from "@/db/schema";
import { eq } from "drizzle-orm";

async function getAuthUser(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return null;
  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  return dbUser[0] ?? null;
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await db
    .select()
    .from(strategyTemplates)
    .where(eq(strategyTemplates.userId, user.id))
    .orderBy(strategyTemplates.createdAt);

  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, thesis } = body;

  if (!name || !thesis) {
    return NextResponse.json({ error: "name and thesis are required" }, { status: 400 });
  }

  const [template] = await db
    .insert(strategyTemplates)
    .values({
      userId: user.id,
      name,
      description: body.description ?? null,
      strategyType: body.strategyType ?? "thesis_driven",
      thesis,
      tickerUniverse: body.tickerUniverse ?? [],
      maxPositions: body.maxPositions ?? 10,
      maxPositionPct: body.maxPositionPct != null ? String(body.maxPositionPct) : "10.00",
      minCashReservePct: body.minCashReservePct != null ? String(body.minCashReservePct) : "5.00",
      earningsLookbackDays: body.earningsLookbackDays ?? 3,
      earningsForwardDays: body.earningsForwardDays ?? 7,
      minConfidenceThreshold: body.minConfidenceThreshold != null ? String(body.minConfidenceThreshold) : "0.65",
      autonomous: body.autonomous ?? true,
      rebalanceOnRun: body.rebalanceOnRun ?? false,
      hypothesisConfig: body.hypothesisConfig ?? null,
    })
    .returning();

  return NextResponse.json({ template }, { status: 201 });
}

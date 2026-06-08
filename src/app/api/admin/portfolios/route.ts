import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { portfolios, pipelinePortfolios } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdminUser } from "../_auth";

export async function GET(req: NextRequest) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allPortfolios = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, user.id))
    .orderBy(desc(portfolios.createdAt));

  const enriched = await Promise.all(allPortfolios.map(async (p) => {
    const links = await db
      .select({ portfolioId: pipelinePortfolios.portfolioId })
      .from(pipelinePortfolios)
      .where(eq(pipelinePortfolios.portfolioId, p.id));

    return {
      ...p,
      createdAt: p.createdAt.toISOString(),
      pipelineCount: links.length,
    };
  }));

  return NextResponse.json({ portfolios: enriched });
}

export async function POST(req: NextRequest) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (body.startingBalance !== undefined) {
    const n = parseFloat(body.startingBalance);
    if (isNaN(n) || n <= 0) {
      return NextResponse.json(
        { error: "startingBalance must be a valid positive decimal" },
        { status: 400 }
      );
    }
  }

  const trimmedName = body.name.trim();
  const balance = body.startingBalance ?? "5000.00";

  const [portfolio] = await db
    .insert(portfolios)
    .values({
      userId: user.id,
      name: trimmedName,
      startingBalance: balance,
      cashBalance: balance,
      isDefault: false,
    })
    .returning();

  return NextResponse.json({ portfolio }, { status: 201 });
}

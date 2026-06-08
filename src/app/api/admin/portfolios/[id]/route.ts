import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { portfolios, pipelinePortfolios } from "@/db/schema";
import { eq, and, ne, asc } from "drizzle-orm";
import { requireAdminUser } from "../../_auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  if (body.startingBalance !== undefined) {
    return NextResponse.json(
      { error: "startingBalance is immutable and cannot be updated" },
      { status: 400 }
    );
  }

  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }

  if (body.cashBalance !== undefined) {
    const n = parseFloat(body.cashBalance);
    if (isNaN(n) || n <= 0) {
      return NextResponse.json(
        { error: "cashBalance must be a valid positive decimal" },
        { status: 400 }
      );
    }
  }

  const existing = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, user.id)))
    .limit(1);

  if (!existing[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const updateFields: Record<string, unknown> = {};
  if (body.name !== undefined) updateFields.name = body.name.trim();
  if (body.cashBalance !== undefined) updateFields.cashBalance = body.cashBalance;

  const [updated] = await db
    .update(portfolios)
    .set(updateFields)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, user.id)))
    .returning();

  return NextResponse.json({ portfolio: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const existing = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, id), eq(portfolios.userId, user.id)))
    .limit(1);

  if (!existing[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const links = await db
    .select()
    .from(pipelinePortfolios)
    .where(eq(pipelinePortfolios.portfolioId, id));

  if (links.length > 0) {
    return NextResponse.json(
      { error: "Portfolio is linked to one or more pipelines and cannot be deleted" },
      { status: 409 }
    );
  }

  if (existing[0].isDefault) {
    const siblings = await db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.userId, user.id), ne(portfolios.id, id)))
      .orderBy(asc(portfolios.createdAt))
      .limit(1);

    await db.delete(portfolios).where(eq(portfolios.id, id));

    if (siblings[0]) {
      await db
        .update(portfolios)
        .set({ isDefault: true })
        .where(eq(portfolios.id, siblings[0].id));
    }
  } else {
    await db.delete(portfolios).where(eq(portfolios.id, id));
  }

  return new NextResponse(null, { status: 204 });
}

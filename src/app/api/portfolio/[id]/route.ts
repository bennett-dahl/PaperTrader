import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, users } from "@/db/schema";
import { eq, and, ne, desc } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, cashBalance } = body as { name?: string; cashBalance?: number };

  if (name === undefined && cashBalance === undefined)
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });

  if (name !== undefined && !name.trim())
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });

  if (cashBalance !== undefined && (typeof cashBalance !== "number" || cashBalance < 0))
    return NextResponse.json({ error: "Cash balance must be a non-negative number" }, { status: 400 });

  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  if (!dbUser[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const portfolio = await db.select().from(portfolios).where(eq(portfolios.id, id)).limit(1);
  if (!portfolio[0]) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  if (portfolio[0].userId !== dbUser[0].id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updates: Partial<{ name: string; cashBalance: string; startingBalance: string }> = {};
  if (name !== undefined) updates.name = name.trim();
  if (cashBalance !== undefined) {
    const currentCash = parseFloat(portfolio[0].cashBalance);
    const delta = cashBalance - currentCash;
    const newStartingBalance = parseFloat(portfolio[0].startingBalance) + delta;
    updates.cashBalance = cashBalance.toFixed(2);
    updates.startingBalance = newStartingBalance.toFixed(2);
  }

  const updated = await db
    .update(portfolios)
    .set(updates)
    .where(eq(portfolios.id, id))
    .returning();

  return NextResponse.json({ portfolio: updated[0] });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user?.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dbUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
  if (!dbUser[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const portfolio = await db.select().from(portfolios).where(eq(portfolios.id, id)).limit(1);
  if (!portfolio[0]) return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  if (portfolio[0].userId !== dbUser[0].id)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Auto-promote another portfolio to isDefault if needed
  if (portfolio[0].isDefault) {
    const others = await db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.userId, dbUser[0].id), ne(portfolios.id, id)))
      .orderBy(desc(portfolios.createdAt))
      .limit(1);

    if (others[0]) {
      await db.update(portfolios).set({ isDefault: true }).where(eq(portfolios.id, others[0].id));
    }
  }

  await db.delete(portfolios).where(eq(portfolios.id, id));

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, portfolioBuilderPresets } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await req.json();
  const { name, riskLevel, investAmount, categories, stockCount } = body as {
    name?: string;
    riskLevel?: string;
    investAmount?: number;
    categories?: string[];
    stockCount?: number;
  };

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updateData.name = name.trim();
  if (riskLevel !== undefined) {
    if (!["low", "medium", "high"].includes(riskLevel)) {
      return NextResponse.json({ error: "Invalid riskLevel" }, { status: 400 });
    }
    updateData.riskLevel = riskLevel;
  }
  if (investAmount !== undefined) updateData.investAmount = String(investAmount);
  if (categories !== undefined) updateData.categories = categories;
  if (stockCount !== undefined) updateData.stockCount = stockCount;

  const updated = await db
    .update(portfolioBuilderPresets)
    .set(updateData)
    .where(
      and(
        eq(portfolioBuilderPresets.id, id),
        eq(portfolioBuilderPresets.userId, dbUser[0].id)
      )
    )
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  return NextResponse.json({ preset: updated[0] });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const deleted = await db
    .delete(portfolioBuilderPresets)
    .where(
      and(
        eq(portfolioBuilderPresets.id, id),
        eq(portfolioBuilderPresets.userId, dbUser[0].id)
      )
    )
    .returning();

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users, portfolioBuilderPresets } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const presets = await db
    .select()
    .from(portfolioBuilderPresets)
    .where(eq(portfolioBuilderPresets.userId, dbUser[0].id))
    .orderBy(portfolioBuilderPresets.createdAt);

  return NextResponse.json({ presets });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, riskLevel, investAmount, categories, stockCount } = body as {
    name?: string;
    riskLevel?: string;
    investAmount?: number;
    categories?: string[];
    stockCount?: number;
  };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Preset name is required" }, { status: 400 });
  }
  if (!riskLevel || !["low", "medium", "high"].includes(riskLevel)) {
    return NextResponse.json({ error: "Invalid riskLevel" }, { status: 400 });
  }
  if (!investAmount || investAmount <= 0) {
    return NextResponse.json({ error: "investAmount must be positive" }, { status: 400 });
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const preset = await db
    .insert(portfolioBuilderPresets)
    .values({
      userId: dbUser[0].id,
      name: name.trim(),
      riskLevel: riskLevel as "low" | "medium" | "high",
      investAmount: String(investAmount),
      categories: categories ?? [],
      stockCount: stockCount ?? 5,
    })
    .returning();

  return NextResponse.json({ preset: preset[0] });
}

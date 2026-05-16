import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, users } from "@/db/schema";
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

  const userPortfolios = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, dbUser[0].id));

  return NextResponse.json({ portfolios: userPortfolios });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name } = body as { name?: string };

  if (!name?.trim()) {
    return NextResponse.json({ error: "Portfolio name is required" }, { status: 400 });
  }

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const portfolio = await db
    .insert(portfolios)
    .values({
      userId: dbUser[0].id,
      name: name.trim(),
      startingBalance: "5000.00",
      cashBalance: "5000.00",
      isDefault: false,
    })
    .returning();

  return NextResponse.json({ portfolio: portfolio[0] });
}

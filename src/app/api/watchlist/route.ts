import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, users, watchlist } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { ticker, portfolioId } = body as { ticker: string; portfolioId: string };

  if (!ticker || !portfolioId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify portfolio ownership
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const portfolio = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, dbUser[0].id)))
    .limit(1);

  if (!portfolio[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  // Check if already watching
  const existing = await db
    .select()
    .from(watchlist)
    .where(
      and(
        eq(watchlist.portfolioId, portfolioId),
        eq(watchlist.ticker, ticker.toUpperCase())
      )
    )
    .limit(1);

  if (existing[0]) {
    return NextResponse.json({ item: existing[0], alreadyExists: true });
  }

  const item = await db
    .insert(watchlist)
    .values({
      portfolioId,
      ticker: ticker.toUpperCase(),
    })
    .returning();

  return NextResponse.json({ item: item[0] });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const watchlistId = searchParams.get("id");

  if (!watchlistId) {
    return NextResponse.json({ error: "Missing id param" }, { status: 400 });
  }

  await db.delete(watchlist).where(eq(watchlist.id, watchlistId));

  return NextResponse.json({ success: true });
}

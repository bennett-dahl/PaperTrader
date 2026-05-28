import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { portfolios, users, watchlist } from "@/db/schema";
import { eq, and } from "drizzle-orm";

type RouteParams = { params: Promise<{ portfolioId: string; ticker: string }> };

async function verifyOwnership(
  email: string,
  portfolioId: string
): Promise<boolean> {
  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!dbUser[0]) return false;

  const portfolio = await db
    .select()
    .from(portfolios)
    .where(
      and(
        eq(portfolios.id, portfolioId),
        eq(portfolios.userId, dbUser[0].id)
      )
    )
    .limit(1);
  return !!portfolio[0];
}

/** GET /api/watchlist/[portfolioId]/[ticker] → { watching: boolean } */
export async function GET(
  _req: NextRequest,
  { params }: RouteParams
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { portfolioId, ticker } = await params;
  const upperTicker = ticker.toUpperCase();

  const owned = await verifyOwnership(session.user.email, portfolioId);
  if (!owned) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  const existing = await db
    .select()
    .from(watchlist)
    .where(
      and(
        eq(watchlist.portfolioId, portfolioId),
        eq(watchlist.ticker, upperTicker)
      )
    )
    .limit(1);

  return NextResponse.json({ watching: !!existing[0] });
}

/** POST /api/watchlist/[portfolioId]/[ticker] → { watching: true } */
export async function POST(
  _req: NextRequest,
  { params }: RouteParams
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { portfolioId, ticker } = await params;
  const upperTicker = ticker.toUpperCase();

  const owned = await verifyOwnership(session.user.email, portfolioId);
  if (!owned) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  // Upsert (idempotent)
  const existing = await db
    .select()
    .from(watchlist)
    .where(
      and(
        eq(watchlist.portfolioId, portfolioId),
        eq(watchlist.ticker, upperTicker)
      )
    )
    .limit(1);

  if (!existing[0]) {
    await db.insert(watchlist).values({ portfolioId, ticker: upperTicker });
  }

  return NextResponse.json({ watching: true });
}

/** DELETE /api/watchlist/[portfolioId]/[ticker] → { watching: false } */
export async function DELETE(
  _req: NextRequest,
  { params }: RouteParams
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { portfolioId, ticker } = await params;
  const upperTicker = ticker.toUpperCase();

  const owned = await verifyOwnership(session.user.email, portfolioId);
  if (!owned) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  await db
    .delete(watchlist)
    .where(
      and(
        eq(watchlist.portfolioId, portfolioId),
        eq(watchlist.ticker, upperTicker)
      )
    );

  return NextResponse.json({ watching: false });
}

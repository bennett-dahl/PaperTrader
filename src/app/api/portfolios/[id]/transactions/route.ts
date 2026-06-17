import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, portfolios, transactions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: portfolioId } = await params;

  const dbUser = await db
    .select()
    .from(users)
    .where(eq(users.email, session.user.email))
    .limit(1);

  if (!dbUser[0]) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify portfolio ownership
  const portfolio = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, dbUser[0].id)))
    .limit(1);

  if (!portfolio[0]) {
    return NextResponse.json({ error: "Portfolio not found" }, { status: 404 });
  }

  // Optional ticker filter — normalize to uppercase
  const { searchParams } = new URL(req.url);
  const tickerParam = searchParams.get("ticker");
  const tickerFilter = tickerParam ? tickerParam.toUpperCase() : null;

  // Query with pipeline relation
  const rows = await db.query.transactions.findMany({
    where: tickerFilter
      ? and(
          eq(transactions.portfolioId, portfolioId),
          eq(transactions.ticker, tickerFilter)
        )
      : eq(transactions.portfolioId, portfolioId),
    orderBy: [desc(transactions.executedAt)],
    limit: 100,
    with: {
      pipeline: {
        columns: { id: true, name: true },
      },
    },
  });

  const result = rows.map((row) => ({
    id: row.id,
    ticker: row.ticker,
    type: row.type,
    shares: row.shares,
    pricePerShare: row.pricePerShare,
    totalAmount: row.totalAmount,
    costBasisAtSale: row.costBasisAtSale ?? null,
    executedAt: row.executedAt,
    pipelineId: row.pipelineId ?? null,
    pipelineName: row.pipeline?.name ?? null,
  }));

  return NextResponse.json(result);
}

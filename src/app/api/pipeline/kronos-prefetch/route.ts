import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines, kronosForecasts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const POST = verifySignatureAppRouter(async (_req: NextRequest) => {
  const today = new Date().toISOString().split("T")[0];

  // Find all active kronos_rotation pipelines with non-empty kronosTickerUniverse
  const activePipelines = await db
    .select({
      id: pipelines.id,
      kronosTickerUniverse: pipelines.kronosTickerUniverse,
    })
    .from(pipelines)
    .where(
      and(
        eq(pipelines.status, "active"),
        eq(pipelines.strategyType, "kronos_rotation")
      )
    );

  const modalUrl = process.env.MODAL_API_URL;
  const kronosSecret = process.env.KRONOS_SECRET;

  if (!modalUrl || !kronosSecret) {
    console.error("[kronos-prefetch] Missing MODAL_API_URL or KRONOS_SECRET");
    return NextResponse.json({ error: "Modal not configured" }, { status: 500 });
  }

  let totalUpserted = 0;

  for (const pipeline of activePipelines) {
    const tickers = (pipeline.kronosTickerUniverse as string[] | null) ?? [];

    if (tickers.length === 0) {
      console.warn(
        `[kronos-prefetch] Pipeline ${pipeline.id} has empty kronosTickerUniverse, skipping`
      );
      continue;
    }

    // Call Modal endpoint
    let results: Array<{ ticker: string; predictedReturnPct: number }>;
    try {
      const response = await fetch(modalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${kronosSecret}`,
        },
        body: JSON.stringify({
          tickers,
          lookback: 60,
          pipeline_id: pipeline.id,
        }),
      });

      if (!response.ok) {
        console.error(
          `[kronos-prefetch] Modal returned ${response.status} for pipeline ${pipeline.id}`
        );
        continue;
      }

      const data = await response.json();
      results = data.results ?? [];
    } catch (err) {
      console.error(
        `[kronos-prefetch] Fetch failed for pipeline ${pipeline.id}:`,
        err
      );
      continue;
    }

    if (results.length === 0) {
      console.warn(
        `[kronos-prefetch] No results from Modal for pipeline ${pipeline.id}`
      );
      continue;
    }

    // Upsert into kronos_forecasts — conflict on (pipelineId, ticker, forecastDate)
    for (const result of results) {
      await db
        .insert(kronosForecasts)
        .values({
          pipelineId: pipeline.id,
          ticker: result.ticker,
          predictedReturnPct: String(result.predictedReturnPct),
          forecastDate: today,
        })
        .onConflictDoUpdate({
          target: [
            kronosForecasts.pipelineId,
            kronosForecasts.ticker,
            kronosForecasts.forecastDate,
          ],
          set: {
            predictedReturnPct: String(result.predictedReturnPct),
            createdAt: new Date(),
          },
        });

      totalUpserted++;
    }

    console.log(
      `[kronos-prefetch] Pipeline ${pipeline.id}: upserted ${results.length} forecasts for ${today}`
    );
  }

  return NextResponse.json({ ok: true, upserted: totalUpserted });
});

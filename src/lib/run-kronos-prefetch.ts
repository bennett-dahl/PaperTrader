import { db } from "@/db";
import { pipelines, kronosForecasts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface KronosPrefetchResult {
  upserted: number;
  skipped: number;
  errors: string[];
}

/**
 * Thrown when Modal environment variables are not configured.
 * The pipeline orchestrator treats this as non-fatal; the kronos-prefetch
 * route converts it to a 500 response.
 */
export class ModalNotConfiguredError extends Error {
  constructor() {
    super("MODAL_API_URL or KRONOS_SECRET not configured");
    this.name = "ModalNotConfiguredError";
  }
}

/**
 * Fetches Kronos forecasts from Modal for all active kronos_rotation pipelines
 * and upserts them into the kronos_forecasts table.
 *
 * Throws {@link ModalNotConfiguredError} if env vars are missing.
 * Individual pipeline failures are collected in `errors` but do not throw.
 */
export async function runKronosPrefetch(): Promise<KronosPrefetchResult> {
  const modalUrl = process.env.MODAL_API_URL;
  const kronosSecret = process.env.KRONOS_SECRET;

  if (!modalUrl || !kronosSecret) {
    console.error("[kronos-prefetch] Missing MODAL_API_URL or KRONOS_SECRET");
    throw new ModalNotConfiguredError();
  }

  const today = new Date().toISOString().split("T")[0];

  // Find all active kronos_rotation pipelines with a non-empty ticker universe
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

  let totalUpserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const pipeline of activePipelines) {
    const tickers = (pipeline.kronosTickerUniverse as string[] | null) ?? [];

    if (tickers.length === 0) {
      console.warn(
        `[kronos-prefetch] Pipeline ${pipeline.id} has empty kronosTickerUniverse, skipping`
      );
      skipped++;
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
        errors.push(`pipeline ${pipeline.id}: Modal HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      results = data.results ?? [];
    } catch (err) {
      console.error(
        `[kronos-prefetch] Fetch failed for pipeline ${pipeline.id}:`,
        err
      );
      errors.push(`pipeline ${pipeline.id}: fetch error`);
      continue;
    }

    if (results.length === 0) {
      console.warn(
        `[kronos-prefetch] No results from Modal for pipeline ${pipeline.id}`
      );
      skipped++;
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

  return { upserted: totalUpserted, skipped, errors };
}

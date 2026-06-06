import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { db } from "@/db";
import {
  pipelines, pipelineRuns, decisionLog, holdings,
  portfolios, cachedQuotes, stockUniverse, pipelinePortfolios
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { fetchEarningsSignals } from "@/lib/earnings";
import { buildPrompt, decisionSchema, type AIDecisionOutput } from "@/lib/pipeline-prompt";
import { executeTrade } from "@/lib/trade-executor";

export const POST = verifySignatureAppRouter(async (req: NextRequest) => {
  const startTime = Date.now();
  const { pipelineId, triggeredBy = "qstash" } = await req.json();

  if (!pipelineId) {
    return NextResponse.json({ error: "pipelineId required" }, { status: 400 });
  }

  // Load pipeline with portfolio assignments
  const pipeline = await db.query.pipelines.findFirst({
    where: eq(pipelines.id, pipelineId),
    with: { portfolioLinks: { with: { portfolio: true } } },
  });

  if (!pipeline || pipeline.status !== "active") {
    return NextResponse.json({ skipped: true, reason: "pipeline not active" });
  }

  // Atomically guard against concurrent runs
  let run: typeof pipelineRuns.$inferSelect;
  try {
    [run] = await db
      .insert(pipelineRuns)
      .values({ pipelineId, status: "running", triggeredBy })
      .returning();
  } catch (err) {
    if (err instanceof Error && err.message.includes("pipeline_run_active")) {
      return NextResponse.json({ skipped: true, reason: "run already in progress" });
    }
    throw err;
  }

  try {
    // Resolve ticker universe
    let tickers: string[];
    if (pipeline.tickerUniverse.length > 0) {
      tickers = pipeline.tickerUniverse;
    } else {
      const universe = await db
        .select({ ticker: stockUniverse.ticker })
        .from(stockUniverse)
        .limit(50);
      tickers = universe.map((u) => u.ticker);
    }

    // Fetch earnings signals (cache-first, Finnhub fallback)
    const earningsMap = await fetchEarningsSignals(
      tickers,
      pipeline.earningsLookbackDays,
      pipeline.earningsForwardDays
    );

    const today = new Date().toISOString().split("T")[0];
    let totalExecuted = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const link of pipeline.portfolioLinks) {
      const portfolioId = link.portfolioId;

      const holdingRows = await db
        .select()
        .from(holdings)
        .where(eq(holdings.portfolioId, portfolioId));

      const quoteRows = holdingRows.length > 0
        ? await db.select().from(cachedQuotes).where(
            inArray(cachedQuotes.ticker, holdingRows.map((h) => h.ticker))
          )
        : [];
      const quoteMap = new Map(quoteRows.map((q) => [q.ticker, parseFloat(q.price)]));

      const holdingsWithValue = holdingRows.map((h) => ({
        ticker: h.ticker,
        shares: parseFloat(h.shares),
        avgCostBasis: parseFloat(h.avgCostBasis),
        currentPrice: quoteMap.get(h.ticker) ?? null,
        marketValue: quoteMap.get(h.ticker) ? parseFloat(h.shares) * quoteMap.get(h.ticker)! : null,
      }));

      const cashBalance = parseFloat(link.portfolio.cashBalance);
      const totalValue =
        cashBalance + holdingsWithValue.reduce((s, h) => s + (h.marketValue ?? 0), 0);
      const deployableCash = cashBalance * (parseFloat(link.allocationPct) / 100);

      const portfolioState = { deployableCash, totalValue, holdings: holdingsWithValue };

      // Call AI
      let aiOutput: AIDecisionOutput;
      try {
        const { object, usage } = await generateObject({
          model: anthropic("claude-3-5-haiku-20241022"),
          schema: decisionSchema,
          prompt: buildPrompt(pipeline, tickers, earningsMap, portfolioState, today),
        });
        aiOutput = object;
        totalInputTokens += usage.inputTokens ?? 0;
        totalOutputTokens += usage.outputTokens ?? 0;
      } catch (aiErr) {
        console.error("[pipeline/run] AI failed:", aiErr);
        throw aiErr;
      }

      const validDecisions = aiOutput.decisions.filter((d) => tickers.includes(d.ticker));
      const cashFloor = totalValue * (parseFloat(pipeline.minCashReservePct) / 100);
      let remainingCash = deployableCash;

      for (const decision of validDecisions) {
        const signalSummary = earningsMap.get(decision.ticker)
          ? JSON.stringify(earningsMap.get(decision.ticker))
          : null;

        // Short-circuit non-actionable decisions
        if (decision.action === "HOLD" || decision.action === "SKIP") {
          await db.insert(decisionLog).values({
            runId: run.id,
            pipelineId,
            portfolioId,
            ticker: decision.ticker,
            action: decision.action,
            confidence: String(decision.confidence),
            reasoning: decision.reasoning,
            signalSummary,
            executed: false,
            executionError: null,
          });
          totalSkipped++;
          continue;
        }

        // Confidence gate
        if (decision.confidence < parseFloat(pipeline.minConfidenceThreshold)) {
          await db.insert(decisionLog).values({
            runId: run.id, pipelineId, portfolioId,
            ticker: decision.ticker, action: decision.action,
            confidence: String(decision.confidence),
            reasoning: decision.reasoning, signalSummary,
            executed: false, executionError: "confidence_below_threshold",
          });
          totalSkipped++;
          continue;
        }

        // Autonomous gate
        if (!pipeline.autonomous) {
          await db.insert(decisionLog).values({
            runId: run.id, pipelineId, portfolioId,
            ticker: decision.ticker, action: decision.action,
            confidence: String(decision.confidence),
            reasoning: decision.reasoning, signalSummary,
            executed: false, executionError: "pipeline_not_autonomous",
          });
          totalSkipped++;
          continue;
        }

        let executedShares: number | null = null;
        let priceAtDecision: number | null = null;
        let executionError: string | null = null;
        let executed = false;

        if (decision.action === "BUY") {
          const currentPositionCount = holdingsWithValue.filter((h) => h.shares > 0).length;
          const isNewPosition = !holdingsWithValue.some((h) => h.ticker === decision.ticker && h.shares > 0);
          if (isNewPosition && currentPositionCount >= pipeline.maxPositions) {
            await db.insert(decisionLog).values({
              runId: run.id, pipelineId, portfolioId,
              ticker: decision.ticker, action: decision.action,
              confidence: String(decision.confidence),
              reasoning: decision.reasoning, signalSummary,
              executed: false, executionError: "max_positions_reached",
            });
            totalSkipped++;
            continue;
          }

          const availableCash = Math.max(0, Math.min(remainingCash, cashBalance - cashFloor));
          if (availableCash < 1) {
            executionError = "insufficient_cash";
          } else {
            const allocAmount = availableCash * ((decision.sharesPct ?? 10) / 100);
            const quote = await db.select().from(cachedQuotes)
              .where(eq(cachedQuotes.ticker, decision.ticker)).limit(1);

            if (!quote[0]) {
              executionError = "no_price_data";
            } else {
              priceAtDecision = parseFloat(quote[0].price);
              const currentHolding = holdingsWithValue.find((h) => h.ticker === decision.ticker);
              const existingValue = currentHolding?.marketValue ?? 0;
              const maxPositionValue = totalValue * (parseFloat(pipeline.maxPositionPct) / 100);
              const allowedIncrease = Math.max(0, maxPositionValue - existingValue);

              if (allowedIncrease < 1) {
                executionError = "max_position_size_reached";
              } else {
                const cappedAmount = Math.min(allocAmount, allowedIncrease);
                const sharesToBuy = cappedAmount / priceAtDecision;
                const tradeResult = await executeTrade({
                  portfolioId,
                  ticker: decision.ticker,
                  type: "BUY",
                  shares: sharesToBuy,
                  userId: pipeline.userId,
                });
                if (tradeResult.success) {
                  executed = true;
                  executedShares = sharesToBuy;
                  remainingCash -= cappedAmount;
                  totalExecuted++;
                } else {
                  executionError = tradeResult.error ?? "trade_api_error";
                  totalFailed++;
                }
              }
            }
          }
        } else if (decision.action === "SELL") {
          const holding = holdingsWithValue.find((h) => h.ticker === decision.ticker);
          if (!holding || holding.shares <= 0) {
            executionError = "no_holding";
          } else {
            priceAtDecision = holding.currentPrice;
            const sellShares = holding.shares * ((decision.sharesPct ?? 100) / 100);
            const tradeResult = await executeTrade({
              portfolioId,
              ticker: decision.ticker,
              type: "SELL",
              shares: sellShares,
              userId: pipeline.userId,
            });
            if (tradeResult.success) {
              executed = true;
              executedShares = sellShares;
              totalExecuted++;
            } else {
              executionError = tradeResult.error ?? "trade_api_error";
              totalFailed++;
            }
          }
        }

        if (!executed && !executionError) executionError = "unknown";
        if (!executed) totalSkipped++;

        await db.insert(decisionLog).values({
          runId: run.id, pipelineId, portfolioId,
          ticker: decision.ticker, action: decision.action,
          confidence: String(decision.confidence),
          shares: executedShares !== null ? String(executedShares) : null,
          priceAtDecision: priceAtDecision !== null ? String(priceAtDecision) : null,
          reasoning: decision.reasoning, signalSummary,
          executed, executionError,
        });
      }
    }

    // Finalize run
    const COST_PER_INPUT_TOKEN = 0.80 / 1_000_000;
    const COST_PER_OUTPUT_TOKEN = 4.00 / 1_000_000;
    const costUsd = (totalInputTokens * COST_PER_INPUT_TOKEN) + (totalOutputTokens * COST_PER_OUTPUT_TOKEN);

    await db.update(pipelineRuns).set({
      status: "completed",
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      tickersEvaluated: tickers.length,
      tradesExecuted: totalExecuted,
      tradesSkipped: totalSkipped,
      tradesFailed: totalFailed,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: String(costUsd),
    }).where(eq(pipelineRuns.id, run.id));

    const nextRun = new Date();
    nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    nextRun.setUTCHours(23, 0, 0, 0);

    await db.update(pipelines)
      .set({ lastRunAt: new Date(), nextRunAt: nextRun })
      .where(eq(pipelines.id, pipelineId));

    return NextResponse.json({ success: true, executed: totalExecuted, skipped: totalSkipped });
  } catch (err) {
    await db.update(pipelineRuns).set({
      status: "failed",
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    }).where(eq(pipelineRuns.id, run.id));

    return NextResponse.json({ error: "Pipeline run failed" }, { status: 500 });
  }
});

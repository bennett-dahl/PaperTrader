import { z } from "zod";
import type { EarningsSignal } from "./earnings";

export const decisionSchema = z.object({
  decisions: z.array(
    z.object({
      ticker: z.string(),
      action: z.enum(["BUY", "SELL", "HOLD", "SKIP"]),
      confidence: z.number().min(0).max(1),
      sharesPct: z.number().min(0).max(100).nullable(),
      reasoning: z.string(),
    })
  ),
  overallMarketRead: z.string(),
});

export type AIDecisionOutput = z.infer<typeof decisionSchema>;

export interface PortfolioStateForPrompt {
  deployableCash: number;
  totalValue: number;
  holdings: Array<{
    ticker: string;
    shares: number;
    avgCostBasis: number;
    currentPrice: number | null;
    marketValue: number | null;
  }>;
}

export interface PipelineConfigForPrompt {
  thesis: string;
  strategyType: string;
  maxPositionPct: string;
  minCashReservePct: string;
  earningsLookbackDays: number;
  earningsForwardDays: number;
  minConfidenceThreshold: string;
}

export function buildPrompt(
  pipeline: PipelineConfigForPrompt,
  tickers: string[],
  earningsMap: Map<string, EarningsSignal>,
  portfolioState: PortfolioStateForPrompt,
  today: string
): string {
  const signalLines = tickers.map((ticker) => {
    const signal = earningsMap.get(ticker);
    if (!signal) return `${ticker}: no earnings data in window`;
    return (
      `${ticker}: report=${signal.reportDate} ${signal.reportTime ?? ""} | ` +
      `EPS actual=${signal.epsActual ?? "?"} estimate=${signal.epsEstimate ?? "?"} ` +
      `beat=${signal.epsBeat ?? "?"} surprise=${signal.epsSurprisePct != null ? signal.epsSurprisePct.toFixed(1) + "%" : "?"} | ` +
      `Rev beat=${signal.revenueBeat ?? "?"}`
    );
  });

  const holdingLines =
    portfolioState.holdings.length > 0
      ? portfolioState.holdings.map(
          (h) =>
            `${h.ticker}: ${h.shares.toFixed(2)} shares @ $${h.avgCostBasis.toFixed(2)} avg cost, ` +
            `current=$${h.currentPrice?.toFixed(2) ?? "?"}, value=$${h.marketValue?.toFixed(2) ?? "?"}`
        )
      : ["None"];

  const cashFloor = portfolioState.totalValue * (parseFloat(pipeline.minCashReservePct) / 100);

  return `You are an autonomous AI investment strategy executor for a paper trading simulator. Today: ${today}.

## Investment Strategy
Type: ${pipeline.strategyType}

Thesis:
${pipeline.thesis}

## Portfolio State
Deployable cash: $${portfolioState.deployableCash.toFixed(2)}
Total portfolio value: $${portfolioState.totalValue.toFixed(2)}
Minimum cash reserve (do not breach): $${cashFloor.toFixed(2)} (${pipeline.minCashReservePct}%)
Maximum single position size: ${pipeline.maxPositionPct}% of portfolio ($${(portfolioState.totalValue * parseFloat(pipeline.maxPositionPct) / 100).toFixed(2)})

Current holdings:
${holdingLines.join("\n")}

## Earnings Signals (${pipeline.earningsLookbackDays}d lookback + ${pipeline.earningsForwardDays}d forward)
${signalLines.join("\n")}

## Instructions
Evaluate every ticker in the list above and return a decision for each.

Rules:
- Ground all decisions in the investment thesis
- Use earnings signals as the primary trigger for action
- BUY: sharesPct = % of deployable cash to allocate (e.g., 15 means spend 15% of deployable cash)
- SELL: sharesPct = % of current holding to sell (e.g., 50 means sell half the position)
- HOLD: you own this and want to keep it — sharesPct = null
- SKIP: no action warranted for this ticker — sharesPct = null
- Confidence must be 0.0–1.0. Anything below ${pipeline.minConfidenceThreshold} will be auto-skipped by the system — be honest.
- Do NOT suggest buying a ticker you have no thesis for just because cash is available.
- Return SKIP for tickers with no earnings signal AND no current holding unless the thesis warrants speculative positioning.`;
}

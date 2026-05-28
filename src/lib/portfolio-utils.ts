/**
 * Pure utility functions for portfolio P&L math.
 * No DB or external calls — fully testable.
 */

/** Total current value of a holding */
export function holdingCurrentValue(shares: number, currentPrice: number): number {
  return shares * currentPrice;
}

/** Cost basis of a holding */
export function holdingCostBasis(shares: number, avgCostBasis: number): number {
  return shares * avgCostBasis;
}

/** Absolute gain/loss in dollars */
export function holdingGainLoss(
  shares: number,
  currentPrice: number,
  avgCostBasis: number
): number {
  return holdingCurrentValue(shares, currentPrice) - holdingCostBasis(shares, avgCostBasis);
}

/** Gain/loss as percentage (returns 0 if costBasis is 0) */
export function holdingGainLossPct(
  shares: number,
  currentPrice: number,
  avgCostBasis: number
): number {
  const cost = holdingCostBasis(shares, avgCostBasis);
  if (cost === 0) return 0;
  return (holdingGainLoss(shares, currentPrice, avgCostBasis) / cost) * 100;
}

/** Total portfolio value: cash + sum of all holding current values */
export function portfolioTotalValue(
  cashBalance: number,
  holdings: Array<{ shares: number; currentPrice: number }>
): number {
  const holdingsValue = holdings.reduce(
    (sum, h) => sum + holdingCurrentValue(h.shares, h.currentPrice),
    0
  );
  return cashBalance + holdingsValue;
}

/** Portfolio P&L vs starting balance */
export function portfolioPnL(totalValue: number, startingBalance: number): number {
  return totalValue - startingBalance;
}

/** Portfolio P&L percentage */
export function portfolioPnLPct(totalValue: number, startingBalance: number): number {
  if (startingBalance === 0) return 0;
  return ((totalValue - startingBalance) / startingBalance) * 100;
}

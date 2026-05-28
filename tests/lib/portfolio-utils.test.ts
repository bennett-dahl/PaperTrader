import { describe, it, expect } from "vitest";
import {
  holdingCurrentValue,
  holdingCostBasis,
  holdingGainLoss,
  holdingGainLossPct,
  portfolioTotalValue,
  portfolioPnL,
  portfolioPnLPct,
} from "@/lib/portfolio-utils";

describe("holdingCurrentValue", () => {
  it("returns shares * currentPrice", () => {
    expect(holdingCurrentValue(10, 150)).toBe(1500);
  });

  it("returns 0 when shares=0", () => {
    expect(holdingCurrentValue(0, 150)).toBe(0);
  });

  it("handles fractional shares", () => {
    expect(holdingCurrentValue(2.5, 100)).toBe(250);
  });
});

describe("holdingCostBasis", () => {
  it("returns shares * avgCostBasis", () => {
    expect(holdingCostBasis(10, 120)).toBe(1200);
  });
});

describe("holdingGainLoss", () => {
  it("returns positive when currentPrice > avgCostBasis", () => {
    expect(holdingGainLoss(10, 200, 150)).toBe(500);
  });

  it("returns negative when currentPrice < avgCostBasis", () => {
    expect(holdingGainLoss(10, 100, 150)).toBe(-500);
  });

  it("returns 0 when prices are equal", () => {
    expect(holdingGainLoss(10, 150, 150)).toBe(0);
  });
});

describe("holdingGainLossPct", () => {
  it("returns correct percentage", () => {
    // gain = 10*(200-150) = 500, cost = 10*150 = 1500, pct = 500/1500 * 100 = 33.33...
    expect(holdingGainLossPct(10, 200, 150)).toBeCloseTo(33.33, 1);
  });

  it("returns 0 when costBasis is 0 (no division by zero)", () => {
    expect(holdingGainLossPct(10, 200, 0)).toBe(0);
  });

  it("returns negative percent for loss", () => {
    // loss = 10*(100-150) = -500, cost = 1500, pct = -33.33
    expect(holdingGainLossPct(10, 100, 150)).toBeCloseTo(-33.33, 1);
  });
});

describe("portfolioTotalValue", () => {
  it("sums cash + all holding values", () => {
    const holdings = [
      { shares: 10, currentPrice: 100 },
      { shares: 5, currentPrice: 200 },
    ];
    // 1000 + 1000 + 500 (cash)
    expect(portfolioTotalValue(500, holdings)).toBe(2500);
  });

  it("returns cashBalance when no holdings", () => {
    expect(portfolioTotalValue(3000, [])).toBe(3000);
  });

  it("handles multiple holdings correctly", () => {
    const holdings = [
      { shares: 2, currentPrice: 175 },
      { shares: 3, currentPrice: 50 },
    ];
    // 350 + 150 + 1000 = 1500
    expect(portfolioTotalValue(1000, holdings)).toBe(1500);
  });
});

describe("portfolioPnL", () => {
  it("returns totalValue - startingBalance", () => {
    expect(portfolioPnL(6000, 5000)).toBe(1000);
  });

  it("returns negative when portfolio is down", () => {
    expect(portfolioPnL(4000, 5000)).toBe(-1000);
  });
});

describe("portfolioPnLPct", () => {
  it("returns percent gain relative to starting balance", () => {
    expect(portfolioPnLPct(6000, 5000)).toBe(20);
  });

  it("handles 0 starting balance without dividing by zero", () => {
    expect(portfolioPnLPct(6000, 0)).toBe(0);
  });
});

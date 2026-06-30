import { describe, it, expect } from "vitest";
import { computeKronosTradePct, generateCurvePoints } from "@/lib/kronos-sizing";

const BASE = {
  kronosMinSignalPct: 1,
  kronosMinTradePct: 20,
  kronosMaxTradePct: 80,
  kronosSaturationPct: 5,
  kronosSizingCurve: "linear" as const,
};

describe("computeKronosTradePct", () => {
  it("returns null below threshold", () => {
    expect(computeKronosTradePct(0.5, BASE)).toBeNull();
    expect(computeKronosTradePct(0.99, BASE)).toBeNull();
  });

  it("returns minTradePct at exactly the threshold", () => {
    expect(computeKronosTradePct(1, BASE)).toBe(20);
  });

  it("returns maxTradePct at saturation", () => {
    expect(computeKronosTradePct(5, BASE)).toBe(80);
  });

  it("returns maxTradePct above saturation (clamped)", () => {
    expect(computeKronosTradePct(10, BASE)).toBe(80);
  });

  it("interpolates linearly at midpoint", () => {
    // signal=3, midpoint between 1 and 5 → t=0.5 → 20 + 0.5*(80-20) = 50
    expect(computeKronosTradePct(3, BASE)).toBe(50);
  });

  it("log curve grows faster near threshold", () => {
    const logResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "log" });
    const linResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "linear" });
    expect(logResult!).toBeGreaterThan(linResult!);
  });

  it("power curve grows slower near threshold", () => {
    const powResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "power" });
    const linResult  = computeKronosTradePct(2, { ...BASE, kronosSizingCurve: "linear" });
    expect(powResult!).toBeLessThan(linResult!);
  });

  it("handles degenerate config where saturation <= minSignal", () => {
    expect(computeKronosTradePct(3, { ...BASE, kronosSaturationPct: 1 })).toBe(80);
  });

  it("returns null for zero signal", () => {
    expect(computeKronosTradePct(0, BASE)).toBeNull();
  });
});

describe("generateCurvePoints", () => {
  it("returns expected number of points", () => {
    const pts = generateCurvePoints(BASE, 50);
    expect(pts).toHaveLength(51); // 0..nPoints inclusive
  });

  it("first point has tradePct=0 (below threshold)", () => {
    const pts = generateCurvePoints(BASE, 50);
    expect(pts[0].tradePct).toBe(0);
  });

  it("all tradePct values are within [0, maxTradePct]", () => {
    const pts = generateCurvePoints(BASE, 50);
    for (const p of pts) {
      expect(p.tradePct).toBeGreaterThanOrEqual(0);
      expect(p.tradePct).toBeLessThanOrEqual(BASE.kronosMaxTradePct);
    }
  });

  it("uses default 50 points when nPoints omitted", () => {
    const pts = generateCurvePoints(BASE);
    expect(pts).toHaveLength(51);
  });

  it("max signal in points equals saturation + 2", () => {
    const pts = generateCurvePoints(BASE, 50);
    const maxSignal = pts[pts.length - 1].signal;
    expect(maxSignal).toBeCloseTo(BASE.kronosSaturationPct + 2, 1);
  });
});

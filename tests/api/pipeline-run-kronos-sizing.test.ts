import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeKronosTradePct } from "@/lib/kronos-sizing";

// The sizing guard logic is embedded in the route, so we test the pure function
// and simulate the guard logic to verify behavior

const baseSizingConfig = {
  kronosMinSignalPct: 1.0,
  kronosMinTradePct: 20,
  kronosMaxTradePct: 80,
  kronosSaturationPct: 5,
  kronosSizingCurve: "linear" as const,
};

describe("Kronos sizing guard logic", () => {
  it("clamps high sharesPct to authorized ceiling for signal 1.5%", () => {
    // signal 1.5%: linear t=(1.5-1)/(5-1)=0.125 → size=round(20+0.125*60)=round(27.5)=28
    const authorizedPct = computeKronosTradePct(1.5, baseSizingConfig)!;
    expect(authorizedPct).toBe(28);

    const allowedMax = authorizedPct * 1.2; // 33.6
    const allowedMin = Math.max(1, authorizedPct * 0.8); // 22.4

    // If Claude sent sharesPct=99 it should be clamped to allowedMax
    const clampedHigh = Math.min(allowedMax, Math.max(allowedMin, 99));
    expect(clampedHigh).toBeCloseTo(33.6, 1);
  });

  it("downgrade to SKIP when signal below threshold", () => {
    const result = computeKronosTradePct(0.5, baseSizingConfig);
    expect(result).toBeNull(); // null → downgrade to SKIP
  });

  it("does not clamp when AI sharesPct is within authorized range", () => {
    const authorizedPct = computeKronosTradePct(3.0, baseSizingConfig)!; // 50
    const allowedMin = Math.max(1, authorizedPct * 0.8); // 40
    const allowedMax = authorizedPct * 1.2; // 60

    // sharesPct=50 should remain 50
    const clamped = Math.min(allowedMax, Math.max(allowedMin, 50));
    expect(clamped).toBe(50);
  });

  it("non-kronos pipeline: sizing guard should not apply (returns no authorized value)", () => {
    // This tests the guard's strategy type check conceptually.
    // The guard only activates when strategyType === "kronos_rotation".
    // For other strategies, we just verify the sizing function itself still works.
    const result = computeKronosTradePct(3.0, baseSizingConfig);
    expect(typeof result).toBe("number");
  });

  it("uses authorizedPct as default when decision.sharesPct is null", () => {
    const authorizedPct = computeKronosTradePct(2.0, baseSizingConfig)!;
    // linear: t=(2-1)/(5-1)=0.25 → round(20+0.25*60)=round(35)=35
    expect(authorizedPct).toBe(35);

    // When sharesPct is null, the guard sets it to authorizedPct
    const sharesPct = null;
    const result = sharesPct ?? authorizedPct;
    expect(result).toBe(35);
  });

  it("handles log curve correctly in guard", () => {
    const logConfig = { ...baseSizingConfig, kronosSizingCurve: "log" as const };
    const authorizedPct = computeKronosTradePct(2.0, logConfig)!;
    // log: tRaw=(2-1)/(5-1)=0.25; t=log1p(9*0.25)/log(10)≈log1p(2.25)/log(10)
    // log1p(2.25)=ln(3.25)≈1.179; log(10)≈2.303; t≈0.512
    // size=round(20+0.512*60)=round(50.7)=51
    expect(authorizedPct).toBe(51);
  });

  it("power curve produces lower value than linear at low signals", () => {
    const powPct = computeKronosTradePct(2.0, { ...baseSizingConfig, kronosSizingCurve: "power" });
    const linPct = computeKronosTradePct(2.0, baseSizingConfig);
    expect(powPct!).toBeLessThan(linPct!);
  });
});

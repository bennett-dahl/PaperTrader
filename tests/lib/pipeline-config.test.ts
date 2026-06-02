import { describe, it, expect } from "vitest";
import { resolveConfig } from "@/lib/pipeline-config";
import { DEFAULT_PIPELINE_CONFIG } from "@/lib/pipeline-defaults";
import type { StrategyTemplate } from "@/db/schema";

const baseTemplate: StrategyTemplate = {
  id: "tpl-1",
  userId: "user-1",
  name: "Test Template",
  description: null,
  strategyType: "thesis_driven",
  thesis: "Template thesis text",
  tickerUniverse: ["AAPL", "MSFT"],
  maxPositions: 5,
  maxPositionPct: "15.00",
  minCashReservePct: "10.00",
  earningsLookbackDays: 5,
  earningsForwardDays: 10,
  minConfidenceThreshold: "0.70",
  autonomous: false,
  allowShortSell: false,
  rebalanceOnRun: false,
  hypothesisConfig: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("resolveConfig", () => {
  it("uses defaults when no template and no user input", () => {
    const { resolved, overrides } = resolveConfig(null, { thesis: "My thesis" });
    expect(resolved.maxPositions).toBe(DEFAULT_PIPELINE_CONFIG.maxPositions);
    expect(resolved.autonomous).toBe(DEFAULT_PIPELINE_CONFIG.autonomous);
    // thesis is always tracked as override when no template (no baseline thesis in defaults)
    expect(overrides).toContain("thesis");
  });

  it("inherits all fields from template when no user overrides", () => {
    const { resolved, overrides } = resolveConfig(baseTemplate, { thesis: "Template thesis text" });
    expect(resolved.maxPositions).toBe(5);
    expect(resolved.maxPositionPct).toBe("15.00");
    expect(resolved.autonomous).toBe(false);
    expect(overrides).toEqual([]);
  });

  it("tracks overridden fields when user differs from template", () => {
    const { resolved, overrides } = resolveConfig(baseTemplate, {
      thesis: "Template thesis text",
      maxPositions: 20,
      autonomous: true,
    });
    expect(resolved.maxPositions).toBe(20);
    expect(resolved.autonomous).toBe(true);
    expect(overrides).toContain("maxPositions");
    expect(overrides).toContain("autonomous");
    expect(overrides).not.toContain("maxPositionPct"); // not overridden
  });

  it("does not track as override when user value matches template", () => {
    const { overrides } = resolveConfig(baseTemplate, {
      thesis: "Template thesis text",
      maxPositions: 5, // same as template
    });
    expect(overrides).not.toContain("maxPositions");
  });

  it("handles empty tickerUniverse override", () => {
    const { resolved, overrides } = resolveConfig(baseTemplate, {
      thesis: "Template thesis text",
      tickerUniverse: [],
    });
    expect(resolved.tickerUniverse).toEqual([]);
    expect(overrides).toContain("tickerUniverse");
  });

  it("resolves thesis from user input when null template", () => {
    const { resolved } = resolveConfig(null, { thesis: "User provided thesis" });
    expect(resolved.thesis).toBe("User provided thesis");
  });
});

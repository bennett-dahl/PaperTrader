import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("featureFlags", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("SUGGEST_FORCE_FRESH_PRICES is false when env var not set", async () => {
    delete process.env.SUGGEST_FORCE_FRESH_PRICES;
    vi.resetModules();
    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.SUGGEST_FORCE_FRESH_PRICES).toBe(false);
  });

  it("SUGGEST_FORCE_FRESH_PRICES is false when set to 'false'", async () => {
    process.env.SUGGEST_FORCE_FRESH_PRICES = "false";
    vi.resetModules();
    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.SUGGEST_FORCE_FRESH_PRICES).toBe(false);
  });

  it("SUGGEST_FORCE_FRESH_PRICES is true when set to 'true'", async () => {
    process.env.SUGGEST_FORCE_FRESH_PRICES = "true";
    vi.resetModules();
    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.SUGGEST_FORCE_FRESH_PRICES).toBe(true);
  });
});

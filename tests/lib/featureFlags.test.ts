import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Unmock featureFlags since it's globally mocked in setup.ts
vi.unmock("@/lib/featureFlags");

describe("featureFlags", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("SUGGEST_FORCE_FRESH_PRICES is false when env var not set", async () => {
    vi.stubEnv("SUGGEST_FORCE_FRESH_PRICES", "");
    vi.resetModules();
    vi.unmock("@/lib/featureFlags");
    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.SUGGEST_FORCE_FRESH_PRICES).toBe(false);
  });

  it("SUGGEST_FORCE_FRESH_PRICES is false when set to 'false'", async () => {
    vi.stubEnv("SUGGEST_FORCE_FRESH_PRICES", "false");
    vi.resetModules();
    vi.unmock("@/lib/featureFlags");
    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.SUGGEST_FORCE_FRESH_PRICES).toBe(false);
  });

  it("SUGGEST_FORCE_FRESH_PRICES is true when set to 'true'", async () => {
    vi.stubEnv("SUGGEST_FORCE_FRESH_PRICES", "true");
    vi.resetModules();
    vi.unmock("@/lib/featureFlags");
    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.SUGGEST_FORCE_FRESH_PRICES).toBe(true);
  });
});

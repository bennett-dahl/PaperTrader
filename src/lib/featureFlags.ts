/**
 * Feature flags — read from environment variables.
 * Server-side only (never imported in client components).
 */

export const featureFlags = {
  /**
   * When true, /api/suggest always fetches fresh prices from Finnhub
   * instead of using cached quotes. Useful for testing.
   */
  SUGGEST_FORCE_FRESH_PRICES:
    process.env.SUGGEST_FORCE_FRESH_PRICES === "true",
} as const;

export type FeatureFlags = typeof featureFlags;

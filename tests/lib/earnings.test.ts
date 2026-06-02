import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import type { EarningsSignal } from "@/lib/earnings";

// Mock yahoo-finance2
vi.mock("yahoo-finance2", () => ({
  default: {
    quoteSummary: vi.fn().mockResolvedValue({
      upgradeDowngradeHistory: { history: [] },
    }),
  },
}));

// Mock finnhub
vi.mock("@/lib/finnhub", () => ({
  getFinnhubClient: vi.fn(() => ({
    earningsCalendar: vi.fn(),
  })),
}));

describe("earnings module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchEarningsSignals", () => {
    it("returns empty map for empty ticker list", async () => {
      const { fetchEarningsSignals } = await import("@/lib/earnings");
      const result = await fetchEarningsSignals([], 3, 7);
      expect(result.size).toBe(0);
    });

    it("returns cached signals from DB without calling Finnhub", async () => {
      const now = new Date();
      const mockCacheRow = {
        ticker: "AAPL",
        reportDate: new Date().toISOString().split("T")[0],
        reportTime: "amc",
        epsActual: "2.50",
        epsEstimate: "2.10",
        epsBeat: true,
        epsSurprisePct: "19.05",
        analystRevisionDirection: "up",
        revenueActual: "120000000000.00",
        revenueEstimate: "115000000000.00",
        revenueBeat: true,
        rawData: null,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
        id: "signal-1",
      };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([mockCacheRow]),
        }),
      } as any);

      const { fetchEarningsSignals } = await import("@/lib/earnings");
      const result = await fetchEarningsSignals(["AAPL"], 3, 7);

      expect(result.has("AAPL")).toBe(true);
      const signal = result.get("AAPL")!;
      expect(signal.epsBeat).toBe(true);
      expect(signal.epsActual).toBe(2.5);
    });
  });

  describe("fetchAnalystRevisionDirection", () => {
    it("returns 'up' when more upgrades than downgrades", async () => {
      const yahooFinance = (await import("yahoo-finance2")).default;
      const cutoff = Math.floor((Date.now() - 10 * 86400000) / 1000);
      vi.mocked(yahooFinance.quoteSummary).mockResolvedValue({
        upgradeDowngradeHistory: {
          history: [
            { epochGradeDate: cutoff, action: "up" },
            { epochGradeDate: cutoff, action: "up" },
            { epochGradeDate: cutoff, action: "down" },
          ],
        },
      } as any);

      const { fetchAnalystRevisionDirection } = await import("@/lib/earnings");
      const dir = await fetchAnalystRevisionDirection("AAPL");
      expect(dir).toBe("up");
    });

    it("returns 'down' when more downgrades than upgrades", async () => {
      const yahooFinance = (await import("yahoo-finance2")).default;
      const cutoff = Math.floor((Date.now() - 10 * 86400000) / 1000);
      vi.mocked(yahooFinance.quoteSummary).mockResolvedValue({
        upgradeDowngradeHistory: {
          history: [
            { epochGradeDate: cutoff, action: "down" },
            { epochGradeDate: cutoff, action: "down" },
            { epochGradeDate: cutoff, action: "up" },
          ],
        },
      } as any);

      const { fetchAnalystRevisionDirection } = await import("@/lib/earnings");
      const dir = await fetchAnalystRevisionDirection("AAPL");
      expect(dir).toBe("down");
    });

    it("returns 'neutral' when equal upgrades and downgrades", async () => {
      const yahooFinance = (await import("yahoo-finance2")).default;
      const cutoff = Math.floor((Date.now() - 10 * 86400000) / 1000);
      vi.mocked(yahooFinance.quoteSummary).mockResolvedValue({
        upgradeDowngradeHistory: {
          history: [
            { epochGradeDate: cutoff, action: "up" },
            { epochGradeDate: cutoff, action: "down" },
          ],
        },
      } as any);

      const { fetchAnalystRevisionDirection } = await import("@/lib/earnings");
      const dir = await fetchAnalystRevisionDirection("AAPL");
      expect(dir).toBe("neutral");
    });

    it("returns 'neutral' on error", async () => {
      const yahooFinance = (await import("yahoo-finance2")).default;
      vi.mocked(yahooFinance.quoteSummary).mockRejectedValue(new Error("Network error"));

      const { fetchAnalystRevisionDirection } = await import("@/lib/earnings");
      const dir = await fetchAnalystRevisionDirection("AAPL");
      expect(dir).toBe("neutral");
    });

    it("returns 'neutral' for empty history", async () => {
      const yahooFinance = (await import("yahoo-finance2")).default;
      vi.mocked(yahooFinance.quoteSummary).mockResolvedValue({
        upgradeDowngradeHistory: { history: [] },
      } as any);

      const { fetchAnalystRevisionDirection } = await import("@/lib/earnings");
      const dir = await fetchAnalystRevisionDirection("AAPL");
      expect(dir).toBe("neutral");
    });
  });

  describe("mapRow", () => {
    it("converts decimal strings to numbers correctly", async () => {
      const { mapRow } = await import("@/lib/earnings");
      const row = {
        ticker: "AAPL",
        reportDate: "2025-01-01",
        reportTime: "amc",
        epsActual: "2.5000",
        epsEstimate: "2.1000",
        epsBeat: true,
        epsSurprisePct: "19.0476",
        analystRevisionDirection: "up",
        revenueActual: "120000000000.00",
        revenueEstimate: "115000000000.00",
        revenueBeat: true,
      };
      const signal = mapRow(row);
      expect(signal.epsActual).toBe(2.5);
      expect(signal.epsEstimate).toBe(2.1);
      expect(signal.epsSurprisePct).toBeCloseTo(19.0476, 3);
    });

    it("handles null decimal fields", async () => {
      const { mapRow } = await import("@/lib/earnings");
      const row = {
        ticker: "GME",
        reportDate: "2025-01-01",
        reportTime: null,
        epsActual: null,
        epsEstimate: null,
        epsBeat: null,
        epsSurprisePct: null,
        analystRevisionDirection: null,
        revenueActual: null,
        revenueEstimate: null,
        revenueBeat: null,
      };
      const signal = mapRow(row);
      expect(signal.epsActual).toBeNull();
      expect(signal.epsBeat).toBeNull();
    });
  });
});

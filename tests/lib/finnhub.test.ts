import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to unmock @/lib/finnhub for this test file since it's globally mocked
vi.unmock("@/lib/finnhub");

// Mock the finnhub npm package itself
vi.mock("finnhub", () => {
  const mockClient = {
    quote: vi.fn(),
    symbolSearch: vi.fn(),
  };
  return {
    default: {
      DefaultApi: vi.fn(() => mockClient),
    },
    DefaultApi: vi.fn(() => mockClient),
  };
});

describe("lib/finnhub", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FINNHUB_API_KEY = "test-api-key";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getFinnhubClient", () => {
    it("throws when FINNHUB_API_KEY is not set", async () => {
      delete process.env.FINNHUB_API_KEY;
      vi.resetModules();
      vi.mock("finnhub", () => ({
        default: { DefaultApi: vi.fn() },
        DefaultApi: vi.fn(),
      }));
      const { getFinnhubClient } = await import("@/lib/finnhub");
      expect(() => getFinnhubClient()).toThrow("FINNHUB_API_KEY is not set");
    });

    it("returns a client when API key is set", async () => {
      process.env.FINNHUB_API_KEY = "test-key";
      vi.resetModules();
      const finnhubModule = {
        DefaultApi: vi.fn(() => ({ quote: vi.fn() })),
      };
      vi.doMock("finnhub", () => ({ default: finnhubModule, ...finnhubModule }));
      const { getFinnhubClient } = await import("@/lib/finnhub");
      const client = getFinnhubClient();
      expect(client).toBeDefined();
    });
  });

  describe("fetchQuote", () => {
    it("resolves with quote data when callback succeeds", async () => {
      vi.resetModules();
      const mockQuoteData = { c: 150.0, d: 1.5, dp: 1.0 };
      const mockClient = {
        quote: vi.fn((ticker: string, cb: Function) => cb(null, mockQuoteData)),
      };
      vi.doMock("finnhub", () => ({
        default: { DefaultApi: vi.fn(() => mockClient) },
        DefaultApi: vi.fn(() => mockClient),
      }));
      const { fetchQuote } = await import("@/lib/finnhub");
      const result = await fetchQuote(mockClient, "AAPL");
      expect(result).toEqual(mockQuoteData);
    });

    it("resolves with null when callback returns error", async () => {
      const mockClient = {
        quote: vi.fn((_ticker: string, cb: Function) => cb(new Error("API error"), null)),
      };
      const { fetchQuote } = await import("@/lib/finnhub");
      const result = await fetchQuote(mockClient, "AAPL");
      expect(result).toBeNull();
    });

    it("resolves with null when data is null", async () => {
      const mockClient = {
        quote: vi.fn((_ticker: string, cb: Function) => cb(null, null)),
      };
      const { fetchQuote } = await import("@/lib/finnhub");
      const result = await fetchQuote(mockClient, "AAPL");
      expect(result).toBeNull();
    });

    it("resolves with null when data.c is 0 (no price)", async () => {
      const mockClient = {
        quote: vi.fn((_ticker: string, cb: Function) => cb(null, { c: 0, d: 0, dp: 0 })),
      };
      const { fetchQuote } = await import("@/lib/finnhub");
      const result = await fetchQuote(mockClient, "AAPL");
      expect(result).toBeNull();
    });
  });

  describe("searchSymbols", () => {
    it("resolves with symbol results", async () => {
      const mockResults = [
        { symbol: "AAPL", description: "Apple Inc.", type: "Common Stock" },
      ];
      const mockClient = {
        symbolSearch: vi.fn((_query: string, _opts: any, cb: Function) =>
          cb(null, { result: mockResults })
        ),
      };
      const { searchSymbols } = await import("@/lib/finnhub");
      const result = await searchSymbols(mockClient, "AAPL");
      expect(result).toEqual(mockResults);
    });

    it("resolves with empty array when error occurs", async () => {
      const mockClient = {
        symbolSearch: vi.fn((_query: string, _opts: any, cb: Function) =>
          cb(new Error("API error"), null)
        ),
      };
      const { searchSymbols } = await import("@/lib/finnhub");
      const result = await searchSymbols(mockClient, "AAPL");
      expect(result).toEqual([]);
    });

    it("resolves with empty array when data has no result field", async () => {
      const mockClient = {
        symbolSearch: vi.fn((_query: string, _opts: any, cb: Function) =>
          cb(null, {})
        ),
      };
      const { searchSymbols } = await import("@/lib/finnhub");
      const result = await searchSymbols(mockClient, "AAPL");
      expect(result).toEqual([]);
    });

    it("respects limit parameter", async () => {
      const mockResults = Array.from({ length: 20 }, (_, i) => ({
        symbol: `TICKER${i}`,
        description: `Stock ${i}`,
        type: "Common Stock",
      }));
      const mockClient = {
        symbolSearch: vi.fn((_query: string, _opts: any, cb: Function) =>
          cb(null, { result: mockResults })
        ),
      };
      const { searchSymbols } = await import("@/lib/finnhub");
      const result = await searchSymbols(mockClient, "TICK", 3);
      expect(result).toHaveLength(3);
    });
  });
});

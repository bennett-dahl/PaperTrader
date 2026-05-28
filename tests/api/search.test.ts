import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { searchSymbols } from "@/lib/finnhub";
import { mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/search/route";

describe("GET /api/search", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns { results: [] } when q param missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.results).toEqual([]);
      },
    });
  });

  it("returns { results: [] } when q is empty string", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      url: "/api/search?q=",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.results).toEqual([]);
      },
    });
  });

  it("calls searchSymbols with query and returns results", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const mockResults = [
      { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
    ];
    vi.mocked(searchSymbols).mockResolvedValue(mockResults);
    // Mock db.insert for the fire-and-forget cache write
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/search?q=AAPL",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.results).toEqual(mockResults);
        expect(searchSymbols).toHaveBeenCalled();
      },
    });
  });

  it("returns { results: [] } when Finnhub throws", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(searchSymbols).mockRejectedValue(new Error("Finnhub error"));

    await testApiHandler({
      appHandler: handler,
      url: "/api/search?q=AAPL",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.results).toEqual([]);
      },
    });
  });
});

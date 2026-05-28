import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/stock/news/[ticker]/route";

describe("GET /api/stock/news/[ticker]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 500 when FINNHUB_API_KEY not set", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    delete process.env.FINNHUB_API_KEY;
    await testApiHandler({
      appHandler: handler,
      params: { ticker: "AAPL" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(500);
      },
    });
    process.env.FINNHUB_API_KEY = "test-key";
  });
});

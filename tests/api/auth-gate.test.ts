import { testApiHandler } from "next-test-api-route-handler";
import { auth } from "@/auth";
import { vi, describe, beforeEach, test, expect } from "vitest";

import * as tradeHandler from "@/app/api/trade/route";
import * as portfolioHandler from "@/app/api/portfolio/route";
import * as suggestHandler from "@/app/api/suggest/route";
import * as suggestExecuteHandler from "@/app/api/suggest/execute/route";
import * as suggestSwapHandler from "@/app/api/suggest/swap/route";
import * as presetsHandler from "@/app/api/presets/route";
import * as presetsIdHandler from "@/app/api/presets/[id]/route";
import * as watchlistHandler from "@/app/api/watchlist/route";
import * as watchlistTickerHandler from "@/app/api/watchlist/[portfolioId]/[ticker]/route";
import * as stockDetailHandler from "@/app/api/stock-detail/[ticker]/route";
import * as candlesHandler from "@/app/api/stock/candles/[ticker]/route";
import * as newsHandler from "@/app/api/stock/news/[ticker]/route";
import * as quotesHandler from "@/app/api/quotes/route";
import * as searchHandler from "@/app/api/search/route";

type AuthGateCase = {
  name: string;
  handler: object;
  method: "GET" | "POST" | "DELETE" | "PATCH";
  params?: Record<string, string>;
  body?: object;
};

const PROTECTED_ROUTES: AuthGateCase[] = [
  { name: "POST /api/trade", handler: tradeHandler, method: "POST", body: {} },
  { name: "GET /api/portfolio", handler: portfolioHandler, method: "GET" },
  { name: "POST /api/portfolio", handler: portfolioHandler, method: "POST", body: {} },
  { name: "GET /api/suggest", handler: suggestHandler, method: "GET" },
  { name: "POST /api/suggest/execute", handler: suggestExecuteHandler, method: "POST", body: {} },
  { name: "POST /api/suggest/swap", handler: suggestSwapHandler, method: "POST", body: {} },
  { name: "GET /api/presets", handler: presetsHandler, method: "GET" },
  { name: "POST /api/presets", handler: presetsHandler, method: "POST", body: {} },
  { name: "PATCH /api/presets/[id]", handler: presetsIdHandler, method: "PATCH", params: { id: "x" }, body: {} },
  { name: "DELETE /api/presets/[id]", handler: presetsIdHandler, method: "DELETE", params: { id: "x" } },
  { name: "POST /api/watchlist", handler: watchlistHandler, method: "POST", body: {} },
  { name: "DELETE /api/watchlist", handler: watchlistHandler, method: "DELETE" },
  {
    name: "GET /api/watchlist/[pId]/[ticker]",
    handler: watchlistTickerHandler,
    method: "GET",
    params: { portfolioId: "p1", ticker: "AAPL" },
  },
  {
    name: "POST /api/watchlist/[pId]/[ticker]",
    handler: watchlistTickerHandler,
    method: "POST",
    params: { portfolioId: "p1", ticker: "AAPL" },
  },
  {
    name: "DELETE /api/watchlist/[pId]/[ticker]",
    handler: watchlistTickerHandler,
    method: "DELETE",
    params: { portfolioId: "p1", ticker: "AAPL" },
  },
  {
    name: "GET /api/stock-detail/[ticker]",
    handler: stockDetailHandler,
    method: "GET",
    params: { ticker: "AAPL" },
  },
  {
    name: "GET /api/stock/candles/[ticker]",
    handler: candlesHandler,
    method: "GET",
    params: { ticker: "AAPL" },
  },
  {
    name: "GET /api/stock/news/[ticker]",
    handler: newsHandler,
    method: "GET",
    params: { ticker: "AAPL" },
  },
  { name: "GET /api/quotes", handler: quotesHandler, method: "GET" },
  { name: "GET /api/search", handler: searchHandler, method: "GET" },
];

describe("Auth gates — all protected routes return 401 with no session", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue(null);
  });

  test.each(PROTECTED_ROUTES)("$name -> 401", async ({ handler, method, params, body }) => {
    await testApiHandler({
      appHandler: handler as Parameters<typeof testApiHandler>[0]["appHandler"],
      params,
      test: async ({ fetch }) => {
        const res = await fetch({
          method,
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });
        expect(res.status).toBe(401);
        const json = await res.json();
        expect(json.error).toBe("Unauthorized");
      },
    });
  });
});

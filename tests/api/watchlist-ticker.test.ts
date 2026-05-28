import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockWatchlistItem, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/watchlist/[portfolioId]/[ticker]/route";

const params = { portfolioId: mockPortfolio.id, ticker: "AAPL" };

function setupOwnership(portfolioFound = true) {
  let count = 0;
  vi.mocked(db.select).mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(async () => {
          count++;
          if (count === 1) return [mockUser];
          if (count === 2) return portfolioFound ? [mockPortfolio] : [];
          return [];
        }),
      }),
    }),
  } as any));
}

describe("GET /api/watchlist/[portfolioId]/[ticker]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when portfolio not owned", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    setupOwnership(false);
    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns { watching: false } when ticker not in watchlist", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count <= 2) return count === 1 ? [mockUser] : [mockPortfolio];
            return [];
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.watching).toBe(false);
      },
    });
  });

  it("returns { watching: true } when ticker is in watchlist", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            if (count === 2) return [mockPortfolio];
            return [mockWatchlistItem];
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.watching).toBe(true);
      },
    });
  });
});

describe("POST /api/watchlist/[portfolioId]/[ticker]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "POST" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("inserts watchlist entry, returns { watching: true }", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            if (count === 2) return [mockPortfolio];
            return []; // not already watching
          }),
        }),
      }),
    } as any));
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "POST" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.watching).toBe(true);
      },
    });
  });
});

describe("DELETE /api/watchlist/[portfolioId]/[ticker]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("removes watchlist entry, returns { watching: false }", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [mockPortfolio];
          }),
        }),
      }),
    } as any));
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.watching).toBe(false);
      },
    });
  });
});

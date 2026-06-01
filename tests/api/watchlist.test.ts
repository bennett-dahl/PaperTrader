import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPortfolio, mockWatchlistItem, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/watchlist/route";

describe("POST /api/watchlist", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "AAPL", portfolioId: "p1" }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when ticker missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ portfolioId: "p1" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("inserts and returns new watchlist item", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            if (count === 2) return [mockPortfolio];
            return []; // no existing watchlist entry
          }),
        }),
      }),
    } as any));

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockWatchlistItem]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "AAPL", portfolioId: mockPortfolio.id }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.item).toBeDefined();
      },
    });
  });

  it("returns existing item with alreadyExists=true if already watching", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            if (count === 2) return [mockPortfolio];
            return [mockWatchlistItem]; // already exists
          }),
        }),
      }),
    } as any));

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "AAPL", portfolioId: mockPortfolio.id }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.alreadyExists).toBe(true);
      },
    });
  });
  it("returns 404 when user not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "AAPL", portfolioId: "p1" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    let count = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(async () => {
            count++;
            if (count === 1) return [mockUser];
            return [];
          }),
        }),
      }),
    } as any));
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker: "AAPL", portfolioId: "p1" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

});

describe("DELETE /api/watchlist", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when id param missing", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(400);
      },
    });
  });

  it("deletes watchlist item and returns { success: true }", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    } as any);

    await testApiHandler({
      appHandler: handler,
      url: "/api/watchlist?id=watchlist-uuid-1",
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
      },
    });
  });
});

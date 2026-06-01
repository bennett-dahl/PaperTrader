import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  mockUser,
  mockPortfolio,
  mockSession,
  mockDbSelect,
  mockDbUpdate,
  mockDbDelete,
} from "../fixtures/factories";

import * as handler from "@/app/api/portfolio/[id]/route";

// Helpers for chaining db.select calls in sequence
function mockSelectSequence(...results: unknown[][]) {
  let idx = 0;
  vi.mocked(db.select).mockImplementation(() => {
    const result = results[idx] ?? [];
    idx++;
    return mockDbSelect(result) as any;
  });
}

describe("PATCH /api/portfolio/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when no fields provided", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when name is empty string", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when cashBalance is negative", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: -100 }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when cashBalance is not a number", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: "abc" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 404 when user not in db", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([]); // user not found

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([mockUser], []); // user found, portfolio not found

    await testApiHandler({
      appHandler: handler,
      params: { id: "nonexistent" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 403 when portfolio belongs to different user", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const otherUserPortfolio = { ...mockPortfolio, userId: "other-user-id" };
    mockSelectSequence([mockUser], [otherUserPortfolio]);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        });
        expect(res.status).toBe(403);
      },
    });
  });

  it("renames portfolio successfully", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([mockUser], [mockPortfolio]);
    const updatedPortfolio = { ...mockPortfolio, name: "New Name" };
    vi.mocked(db.update).mockReturnValue(mockDbUpdate([updatedPortfolio]) as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.portfolio).toBeDefined();
        expect(json.portfolio.name).toBe("New Name");
      },
    });
  });

  it("updates cashBalance and adjusts startingBalance by delta", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    // mockPortfolio has cashBalance: "3000.00", startingBalance: "5000.00"
    // new cashBalance: 4000 => delta=+1000 => new startingBalance=6000
    mockSelectSequence([mockUser], [mockPortfolio]);
    const updatedPortfolio = {
      ...mockPortfolio,
      cashBalance: "4000.00",
      startingBalance: "6000.00",
    };
    vi.mocked(db.update).mockReturnValue(mockDbUpdate([updatedPortfolio]) as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: 4000 }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.portfolio.cashBalance).toBe("4000.00");
        expect(json.portfolio.startingBalance).toBe("6000.00");
      },
    });
  });

  it("accepts cashBalance of 0", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([mockUser], [mockPortfolio]);
    const updatedPortfolio = { ...mockPortfolio, cashBalance: "0.00" };
    vi.mocked(db.update).mockReturnValue(mockDbUpdate([updatedPortfolio]) as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: 0 }),
        });
        expect(res.status).toBe(200);
      },
    });
  });

  it("can update both name and cashBalance in one request", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([mockUser], [mockPortfolio]);
    const updatedPortfolio = { ...mockPortfolio, name: "Renamed", cashBalance: "2000.00" };
    vi.mocked(db.update).mockReturnValue(mockDbUpdate([updatedPortfolio]) as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Renamed", cashBalance: 2000 }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.portfolio.name).toBe("Renamed");
      },
    });
  });
});

describe("DELETE /api/portfolio/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when user not in db", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([]);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    mockSelectSequence([mockUser], []);

    await testApiHandler({
      appHandler: handler,
      params: { id: "nonexistent" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 403 when portfolio belongs to different user", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const otherUserPortfolio = { ...mockPortfolio, userId: "other-user-id" };
    mockSelectSequence([mockUser], [otherUserPortfolio]);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(403);
      },
    });
  });

  it("deletes a non-default portfolio and returns success", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const nonDefaultPortfolio = { ...mockPortfolio, isDefault: false };
    mockSelectSequence([mockUser], [nonDefaultPortfolio]);
    vi.mocked(db.delete).mockReturnValue(mockDbDelete() as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
      },
    });
  });

  it("auto-promotes another portfolio when deleting the default", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const defaultPortfolio = { ...mockPortfolio, isDefault: true };
    const otherPortfolio = { ...mockPortfolio, id: "portfolio-uuid-2", isDefault: false };

    // The "find others" query uses .where().orderBy().limit() — need full chain support
    let selectIdx = 0;
    const selectResults = [[mockUser], [defaultPortfolio], [otherPortfolio]];
    vi.mocked(db.select).mockImplementation(() => {
      const result = selectResults[selectIdx] ?? [];
      selectIdx++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
          }),
          orderBy: vi.fn().mockResolvedValue(result),
        }),
      } as any;
    });

    vi.mocked(db.update).mockReturnValue(mockDbUpdate([{ ...otherPortfolio, isDefault: true }]) as any);
    vi.mocked(db.delete).mockReturnValue(mockDbDelete() as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        // db.update should have been called to promote the other portfolio
        expect(db.update).toHaveBeenCalled();
      },
    });
  });

  it("deletes default portfolio with no other portfolios (no promotion needed)", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    const defaultPortfolio = { ...mockPortfolio, isDefault: true };

    // The "find others" query uses .where().orderBy().limit() — need full chain support
    let selectIdx = 0;
    const selectResults = [[mockUser], [defaultPortfolio], []];
    vi.mocked(db.select).mockImplementation(() => {
      const result = selectResults[selectIdx] ?? [];
      selectIdx++;
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
          }),
          orderBy: vi.fn().mockResolvedValue(result),
        }),
      } as any;
    });

    vi.mocked(db.delete).mockReturnValue(mockDbDelete() as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        // db.update should NOT have been called since there's nothing to promote
        expect(db.update).not.toHaveBeenCalled();
      },
    });
  });
});

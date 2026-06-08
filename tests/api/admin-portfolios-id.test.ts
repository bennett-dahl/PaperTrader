import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockUser, mockPortfolio } from "../fixtures/factories";

const VALID_SECRET = "test-pipeline-secret";
const VALID_EMAIL = "admin@example.com";

const mockAdminPortfolio = {
  ...mockPortfolio,
  id: "portfolio-1",
  userId: mockUser.id,
  name: "Test Portfolio",
  startingBalance: "5000.00",
  cashBalance: "3000.00",
  isDefault: false,
  createdAt: new Date("2025-01-01"),
};

const mockDefaultPortfolio = {
  ...mockAdminPortfolio,
  id: "portfolio-default",
  isDefault: true,
  createdAt: new Date("2024-12-01"),
};

const mockSiblingPortfolio = {
  ...mockAdminPortfolio,
  id: "portfolio-sibling",
  name: "Sibling Portfolio",
  isDefault: false,
  createdAt: new Date("2025-02-01"),
};

function setupAdminEnv() {
  process.env.PIPELINE_SECRET = VALID_SECRET;
  process.env.ADMIN_USER_EMAIL = VALID_EMAIL;
}

function authHeader() {
  return { Authorization: `Bearer ${VALID_SECRET}` };
}

// Helper: build a select() mock chain ending in .from().where().limit()
function userLookupSelect() {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([mockUser]),
      }),
    }),
  } as any;
}

// Helper: ownership check chain (.from().where().limit() resolves to provided rows)
function ownershipSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as any;
}

// Helper: pipeline links check chain (.from().where() resolves directly)
function pipelineLinksSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
    }),
  } as any;
}

// Helper: siblings query chain (.from().where().orderBy().limit() resolves to provided rows)
function siblingsSelect(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as any;
}

// ── PATCH /api/admin/portfolios/[id] ─────────────────────────────────────────
describe("PATCH /api/admin/portfolios/[id]", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with bad auth", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
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

  it("returns 400 when startingBalance is included in body", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");
    vi.mocked(db.select).mockReturnValueOnce(userLookupSelect());

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ startingBalance: "9999.00" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/startingBalance/i);
      },
    });
  });

  it("returns 400 when name is empty after trim", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");
    vi.mocked(db.select).mockReturnValueOnce(userLookupSelect());

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/name/i);
      },
    });
  });

  it("returns 400 when cashBalance is non-numeric", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");
    vi.mocked(db.select).mockReturnValueOnce(userLookupSelect());

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: "abc" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/cashBalance/i);
      },
    });
  });

  it("returns 400 when cashBalance is negative", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");
    vi.mocked(db.select).mockReturnValueOnce(userLookupSelect());

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: "-50.00" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      return ownershipSelect([]);
    });

    await testApiHandler({
      appHandler: handler,
      params: { id: "nonexistent" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New Name" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("happy path — updates name and returns 200", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      return ownershipSelect([mockAdminPortfolio]);
    });

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockAdminPortfolio, name: "Updated Name" }]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Name" }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.portfolio).toBeDefined();
        expect(data.portfolio.name).toBe("Updated Name");
      },
    });
  });

  it("happy path — updates cashBalance and returns 200", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      return ownershipSelect([mockAdminPortfolio]);
    });

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...mockAdminPortfolio, cashBalance: "2500.00" }]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ cashBalance: "2500.00" }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.portfolio.cashBalance).toBe("2500.00");
      },
    });
  });
});

// ── DELETE /api/admin/portfolios/[id] ────────────────────────────────────────
describe("DELETE /api/admin/portfolios/[id]", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with bad auth", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");
    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when portfolio not found", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      return ownershipSelect([]);
    });

    await testApiHandler({
      appHandler: handler,
      params: { id: "nonexistent" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE", headers: authHeader() });
        expect(res.status).toBe(404);
      },
    });
  });

  it("returns 409 when portfolio has active pipeline links", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      if (callCount === 2) return ownershipSelect([mockAdminPortfolio]);
      return pipelineLinksSelect([
        { id: "link-1", pipelineId: "pipe-1", portfolioId: "portfolio-1" },
      ]);
    });

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE", headers: authHeader() });
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toMatch(/pipeline/i);
      },
    });
  });

  it("happy path — deletes non-default portfolio and returns 204", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      if (callCount === 2) return ownershipSelect([mockAdminPortfolio]);
      return pipelineLinksSelect([]);
    });

    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE", headers: authHeader() });
        expect(res.status).toBe(204);
        expect(vi.mocked(db.update)).not.toHaveBeenCalled();
      },
    });
  });

  it("deletes default portfolio and promotes oldest sibling", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      if (callCount === 2) return ownershipSelect([mockDefaultPortfolio]);
      if (callCount === 3) return pipelineLinksSelect([]);
      return siblingsSelect([mockSiblingPortfolio]);
    });

    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    } as any);

    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-default" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE", headers: authHeader() });
        expect(res.status).toBe(204);
        expect(vi.mocked(db.update)).toHaveBeenCalled();
      },
    });
  });

  it("deletes default portfolio with no siblings — no promotion, returns 204", async () => {
    const handler = await import("@/app/api/admin/portfolios/[id]/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return userLookupSelect();
      if (callCount === 2) return ownershipSelect([mockDefaultPortfolio]);
      if (callCount === 3) return pipelineLinksSelect([]);
      return siblingsSelect([]);
    });

    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "portfolio-default" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE", headers: authHeader() });
        expect(res.status).toBe(204);
        expect(vi.mocked(db.update)).not.toHaveBeenCalled();
      },
    });
  });
});

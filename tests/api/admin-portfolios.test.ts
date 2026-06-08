import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockUser, mockPortfolio } from "../fixtures/factories";

const VALID_SECRET = "test-pipeline-secret";
const VALID_EMAIL = "admin@example.com";

const mockAdminPortfolio = {
  ...mockPortfolio,
  id: "portfolio-admin-1",
  userId: mockUser.id,
  name: "Admin Portfolio",
  startingBalance: "5000.00",
  cashBalance: "5000.00",
  isDefault: false,
  createdAt: new Date("2025-01-01"),
};

function setupAdminEnv() {
  process.env.PIPELINE_SECRET = VALID_SECRET;
  process.env.ADMIN_USER_EMAIL = VALID_EMAIL;
}

function authHeader() {
  return { Authorization: `Bearer ${VALID_SECRET}` };
}

// ── GET /api/admin/portfolios ────────────────────────────────────────────────
describe("GET /api/admin/portfolios", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with invalid token", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: { Authorization: "Bearer wrong" },
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 401 with no auth header", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns empty portfolios array when user has none", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockUser]),
            }),
          }),
        } as any;
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.portfolios).toEqual([]);
      },
    });
  });

  it("returns portfolio list with pipelineCount", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");

    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // user lookup: .from().where().limit()
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockUser]),
            }),
          }),
        } as any;
      }
      if (callCount === 2) {
        // portfolio list: .from().where().orderBy()
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([mockAdminPortfolio]),
            }),
          }),
        } as any;
      }
      // pipeline links count: .from().where() resolves directly
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any;
    });

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "GET",
          headers: authHeader(),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data.portfolios)).toBe(true);
        expect(data.portfolios).toHaveLength(1);
        expect(data.portfolios[0].pipelineCount).toBe(0);
        expect(data.portfolios[0].name).toBe("Admin Portfolio");
      },
    });
  });
});

// ── POST /api/admin/portfolios ───────────────────────────────────────────────
describe("POST /api/admin/portfolios", () => {
  beforeEach(() => {
    setupAdminEnv();
    vi.resetModules();
  });

  it("returns 401 with bad auth", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Test" }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when name is missing", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/name/i);
      },
    });
  });

  it("returns 400 when name is empty after trim", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "   " }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/name/i);
      },
    });
  });

  it("returns 400 when startingBalance is non-numeric", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Portfolio", startingBalance: "not-a-number" }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/startingBalance/i);
      },
    });
  });

  it("returns 400 when startingBalance is zero", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Portfolio", startingBalance: "0" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when startingBalance is negative", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Portfolio", startingBalance: "-100.00" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("happy path — creates portfolio with default balance and returns 201", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ ...mockAdminPortfolio, name: "My Portfolio" }]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Portfolio" }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.portfolio).toBeDefined();
        expect(data.portfolio.name).toBe("My Portfolio");
      },
    });
  });

  it("happy path — creates portfolio with custom startingBalance and returns 201", async () => {
    const handler = await import("@/app/api/admin/portfolios/route");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);

    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{
          ...mockAdminPortfolio,
          name: "My Portfolio",
          startingBalance: "10000.00",
          cashBalance: "10000.00",
        }]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { ...authHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Portfolio", startingBalance: "10000.00" }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.portfolio).toBeDefined();
        expect(data.portfolio.startingBalance).toBe("10000.00");
      },
    });
  });
});

import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/strategy-templates/route";

function setupAuth(authed = true) {
  vi.mocked(auth).mockResolvedValue(authed ? (mockSession as any) : null);
}

const mockTemplate = {
  id: "tpl-1",
  userId: mockUser.id,
  name: "Test Strategy",
  description: null,
  strategyType: "thesis_driven",
  thesis: "Buy stocks that beat earnings.",
  tickerUniverse: [],
  maxPositions: 10,
  maxPositionPct: "10.00",
  minCashReservePct: "5.00",
  earningsLookbackDays: 3,
  earningsForwardDays: 7,
  minConfidenceThreshold: "0.65",
  autonomous: true,
  allowShortSell: false,
  rebalanceOnRun: false,
  hypothesisConfig: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("GET /api/strategy-templates", () => {
  it("returns 401 when not authenticated", async () => {
    setupAuth(false);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns templates list for authenticated user", async () => {
    setupAuth();
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
          orderBy: vi.fn().mockResolvedValue([mockTemplate]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data.templates)).toBe(true);
      },
    });
  });
});

describe("POST /api/strategy-templates", () => {
  it("returns 401 when not authenticated", async () => {
    setupAuth(false);
    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Test", thesis: "Thesis" }),
        });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 400 when name is missing", async () => {
    setupAuth();
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thesis: "Some thesis" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 400 when thesis is missing", async () => {
    setupAuth();
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "My Template" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("creates template and returns 201", async () => {
    setupAuth();
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockTemplate]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Test Strategy", thesis: "Buy stocks that beat earnings." }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.template.name).toBe("Test Strategy");
      },
    });
  });
});

import { testApiHandler } from "next-test-api-route-handler";
import { describe, it, expect, vi } from "vitest";
import { auth } from "@/auth";
import { db } from "@/db";
import { mockUser, mockPreset, mockSession } from "../fixtures/factories";

import * as handler from "@/app/api/presets/[id]/route";

describe("PATCH /api/presets/[id]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { id: "preset-uuid-1" },
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

  it("returns 400 when riskLevel invalid", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "preset-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ riskLevel: "extreme" }),
        });
        expect(res.status).toBe(400);
      },
    });
  });

  it("returns 404 when preset not found or not owned", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
      }),
    } as any);
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "bad-id" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated" }),
        });
        expect(res.status).toBe(404);
      },
    });
  });

  it("updates and returns preset", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
      }),
    } as any);
    const updatedPreset = { ...mockPreset, name: "Updated Name" };
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([updatedPreset]),
        }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "preset-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Updated Name" }),
        });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.preset.name).toBe("Updated Name");
      },
    });
  });
  it("returns 400 when riskLevel is invalid", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPreset.id },
      test: async ({ fetch }) => {
        const res = await fetch({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ riskLevel: "extreme" }),
        });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/invalid riskLevel/i);
      },
    });
  });

});

describe("DELETE /api/presets/[id]", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    await testApiHandler({
      appHandler: handler,
      params: { id: "preset-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(401);
      },
    });
  });

  it("returns 404 when preset not found or not owned", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
      }),
    } as any);
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "bad-id" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(404);
      },
    });
  });

  it("deletes preset and returns { success: true }", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([mockUser]) }),
      }),
    } as any);
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockPreset]),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: "preset-uuid-1" },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
      },
    });
  });
  it("returns 404 when user not found in DELETE", async () => {
    vi.mocked(auth).mockResolvedValue(mockSession as any);
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
      }),
    } as any);

    await testApiHandler({
      appHandler: handler,
      params: { id: mockPreset.id },
      test: async ({ fetch }) => {
        const res = await fetch({ method: "DELETE" });
        expect(res.status).toBe(404);
        const json = await res.json();
        expect(json.error).toMatch(/user not found/i);
      },
    });
  });

});

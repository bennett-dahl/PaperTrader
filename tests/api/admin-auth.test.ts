import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { mockUser } from "../fixtures/factories";

// We test requireAdminUser indirectly via the pipelines admin route
// but also test the _auth module directly

// Mock the db module is already done in setup.ts

const VALID_SECRET = "test-pipeline-secret";
const VALID_EMAIL = "admin@example.com";

async function callRequireAdminUser(authHeader: string | null, email?: string) {
  process.env.PIPELINE_SECRET = VALID_SECRET;
  if (email !== undefined) {
    process.env.ADMIN_USER_EMAIL = email;
  } else {
    delete process.env.ADMIN_USER_EMAIL;
  }

  const { requireAdminUser } = await import("@/app/api/admin/_auth");

  const req = new Request("http://localhost/api/admin/pipelines", {
    headers: authHeader ? { authorization: authHeader } : {},
  });

  return requireAdminUser(req as any);
}

describe("requireAdminUser (_auth.ts)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns null when Authorization header is missing", async () => {
    const result = await callRequireAdminUser(null, VALID_EMAIL);
    expect(result).toBeNull();
  });

  it("returns null when Authorization header has wrong token", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);
    const result = await callRequireAdminUser("Bearer wrong-secret", VALID_EMAIL);
    expect(result).toBeNull();
  });

  it("returns null when ADMIN_USER_EMAIL is not set", async () => {
    const result = await callRequireAdminUser(`Bearer ${VALID_SECRET}`, undefined);
    expect(result).toBeNull();
  });

  it("returns null when user not found in DB", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    } as any);
    const result = await callRequireAdminUser(`Bearer ${VALID_SECRET}`, VALID_EMAIL);
    expect(result).toBeNull();
  });

  it("returns user when valid token and user exists", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockUser]),
        }),
      }),
    } as any);
    const result = await callRequireAdminUser(`Bearer ${VALID_SECRET}`, VALID_EMAIL);
    expect(result).toEqual(mockUser);
  });
});

import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function requireAdminUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.PIPELINE_SECRET;
  if (auth !== `Bearer ${secret}`) {
    console.error(`[requireAdminUser] bearer mismatch: authLen=${auth?.length ?? 0} secretLen=${secret?.length ?? 0}`);
    return null;
  }
  const email = process.env.ADMIN_USER_EMAIL;
  if (!email) {
    console.error("[requireAdminUser] ADMIN_USER_EMAIL not set");
    return null;
  }
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!rows[0]) {
    console.error(`[requireAdminUser] no user row found for email=${email}`);
    // Fallback: find any user in DB (single-user personal app)
    const anyUser = await db.select().from(users).limit(1);
    if (anyUser[0]) {
      console.error(`[requireAdminUser] using fallback user id=${anyUser[0].id}`);
      return anyUser[0];
    }
    console.error("[requireAdminUser] no users in DB at all — user must sign in via web first");
    return null;
  }
  return rows[0];
}

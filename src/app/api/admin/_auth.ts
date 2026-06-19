import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function requireAdminUser(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = process.env.PIPELINE_SECRET;
  if (auth !== `Bearer ${secret}`) return null;
  const email = process.env.ADMIN_USER_EMAIL;
  if (!email) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

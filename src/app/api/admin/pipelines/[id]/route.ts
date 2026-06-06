import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pipelines } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAdminUser } from "../../_auth";

const ALLOWED_STATUS = ["active", "paused", "archived"] as const;
type PipelineStatus = typeof ALLOWED_STATUS[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAdminUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Validate status if provided
  if (body.status !== undefined && !ALLOWED_STATUS.includes(body.status as PipelineStatus)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${ALLOWED_STATUS.join(", ")}` },
      { status: 400 }
    );
  }

  // Check pipeline exists and belongs to admin user
  const existing = await db
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .limit(1);

  if (!existing[0]) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  const updateFields: Record<string, unknown> = { updatedAt: new Date() };
  if (body.status !== undefined) updateFields.status = body.status;
  if (body.name !== undefined) updateFields.name = body.name;
  if (body.autonomous !== undefined) updateFields.autonomous = body.autonomous;

  const [updated] = await db
    .update(pipelines)
    .set(updateFields)
    .where(and(eq(pipelines.id, id), eq(pipelines.userId, user.id)))
    .returning();

  return NextResponse.json({ pipeline: updated });
}

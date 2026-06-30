import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { runKronosPrefetch, ModalNotConfiguredError } from "@/lib/run-kronos-prefetch";

export const POST = verifySignatureAppRouter(async (_req: NextRequest) => {
  try {
    const result = await runKronosPrefetch();
    return NextResponse.json({ ok: true, upserted: result.upserted });
  } catch (err) {
    console.error("[kronos-prefetch] Failed:", err);
    if (err instanceof ModalNotConfiguredError) {
      return NextResponse.json({ error: "Modal not configured" }, { status: 500 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
});

import { NextRequest, NextResponse } from "next/server";
import { getFinnhubClient, searchSymbols } from "@/lib/finnhub";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const client = getFinnhubClient();
    const results = await searchSymbols(client, q, 8);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[api/search] Finnhub error:", err);
    return NextResponse.json({ results: [] });
  }
}

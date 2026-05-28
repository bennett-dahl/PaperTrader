import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  // Last 7 days
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(ticker)}&from=${fmt(from)}&to=${fmt(to)}`;

  try {
    const res = await fetch(url, {
      headers: { "X-Finnhub-Token": apiKey },
      next: { revalidate: 900 }, // 15-min cache
    });

    if (!res.ok) {
      return NextResponse.json({ news: [] });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = await res.json();

    if (!Array.isArray(data)) {
      return NextResponse.json({ news: [] });
    }

    const news = data.slice(0, 10).map((item) => ({
      id: item.id ?? String(item.datetime),
      headline: item.headline ?? "",
      source: item.source ?? "",
      url: item.url ?? "",
      image: item.image ?? null,
      datetime: item.datetime ?? null, // Unix seconds
      summary: item.summary ?? null,
    }));

    return NextResponse.json({ ticker, news });
  } catch (err) {
    console.error("[stock/news] Error:", err);
    return NextResponse.json({ news: [] });
  }
}

import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;

  // Public routes (no session required)
  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/tickers/") ||
    pathname.startsWith("/api/pipeline/kronos-prefetch") ||
    pathname.startsWith("/api/pipeline/run");

  if (!req.auth && !isPublic) {
    const signInUrl = new URL("/", req.nextUrl.origin);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};


export const runtime = 'nodejs';

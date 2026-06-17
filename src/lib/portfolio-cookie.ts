// Shared between server components (cookie read) and the client context
// (cookie write). Kept in a neutral, non-"use client" module so server code
// can import it without crossing a client boundary.
export const PORTFOLIO_COOKIE = "active_portfolio_id";

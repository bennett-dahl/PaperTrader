import "@testing-library/jest-dom";
import { vi, beforeEach, afterEach } from "vitest";

// ─── localStorage mock ──────────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

beforeEach(() => {
  localStorageMock.clear();
});

// ─── Auth mock — module-level, refined per test ────────────────────────────
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// ─── DB mock — module-level ─────────────────────────────────────────────────
vi.mock("@/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    selectDistinct: vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// ─── Finnhub mock ───────────────────────────────────────────────────────────
vi.mock("@/lib/finnhub", () => ({
  getFinnhubClient: vi.fn(() => ({})),
  fetchQuote: vi.fn(),
  searchSymbols: vi.fn(),
}));

// ─── Feature flags mock ─────────────────────────────────────────────────────
vi.mock("@/lib/featureFlags", () => ({
  featureFlags: {
    SUGGEST_FORCE_FRESH_PRICES: false,
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

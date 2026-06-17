import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTrade } from "@/lib/trade-executor";
import { db } from "@/db";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/lib/finnhub", () => ({
  getFinnhubClient: vi.fn(),
  fetchQuote: vi.fn(),
}));

// Helper: build a mock tx object
function makeTx(overrides?: Partial<Record<string, unknown>>) {
  const insert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
  const update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  const del = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  const select = vi.fn();
  return { insert, update, delete: del, select, ...overrides };
}

// Helper: pull the values object passed to the transactions insert.
// The BUY path inserts a holding first, so we must select the insert call
// that carries a `type` field (only the transactions insert does).
function transactionInsert(tx: ReturnType<typeof makeTx>) {
  const valuesMock = tx.insert().values as ReturnType<typeof vi.fn>;
  const call = valuesMock.mock.calls.find((c) => c[0] && "type" in c[0]);
  return call?.[0] as Record<string, unknown>;
}

// Helper: wire tx.select to return portfolio first, then a holding (or none).
function wireSelect(
  tx: ReturnType<typeof makeTx>,
  portfolio: Record<string, unknown>,
  holding: Record<string, unknown> | null
) {
  let selectCallCount = 0;
  tx.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(async () => {
          selectCallCount++;
          if (selectCallCount === 1) return [portfolio];
          return holding ? [holding] : [];
        }),
      }),
    }),
  }));
}

describe("executeTrade — pipelineId written to transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes pipelineId to transaction on BUY when provided", async () => {
    const tx = makeTx();
    wireSelect(tx, { id: "p1", userId: "u1", cashBalance: "5000.00" }, null);

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      await fn(tx);
    });

    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "BUY",
      shares: 1,
      userId: "u1",
      price: 150,
      pipelineId: "pipeline-abc",
    });

    const insertCall = transactionInsert(tx);
    expect(insertCall.pipelineId).toBe("pipeline-abc");
  });

  it("writes null pipelineId on BUY when not provided", async () => {
    const tx = makeTx();
    wireSelect(tx, { id: "p1", userId: "u1", cashBalance: "5000.00" }, null);

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      await fn(tx);
    });

    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "BUY",
      shares: 1,
      userId: "u1",
      price: 150,
    });

    const insertCall = transactionInsert(tx);
    expect(insertCall.pipelineId).toBeNull();
  });
});

describe("executeTrade — costBasisAtSale on SELL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("snapshots avgCostBasis from holding into costBasisAtSale", async () => {
    const tx = makeTx();
    wireSelect(
      tx,
      { id: "p1", userId: "u1", cashBalance: "5000.00" },
      { id: "h1", portfolioId: "p1", ticker: "AAPL", shares: "10.000000", avgCostBasis: "142.5000" }
    );

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      await fn(tx);
    });

    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "SELL",
      shares: 5,
      userId: "u1",
      price: 200,
    });

    const insertCall = transactionInsert(tx);
    expect(insertCall.costBasisAtSale).toBe("142.5000");
  });

  it("costBasisAtSale is null for BUY", async () => {
    const tx = makeTx();
    wireSelect(tx, { id: "p1", userId: "u1", cashBalance: "5000.00" }, null);

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      await fn(tx);
    });

    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "BUY",
      shares: 1,
      userId: "u1",
      price: 150,
    });

    const insertCall = transactionInsert(tx);
    expect(insertCall.costBasisAtSale).toBeNull();
  });

  it("snapshots costBasisAtSale even when full position is sold (holding deleted)", async () => {
    const tx = makeTx();
    // existingShares === shares to sell → triggers tx.delete
    wireSelect(
      tx,
      { id: "p1", userId: "u1", cashBalance: "5000.00" },
      { id: "h1", portfolioId: "p1", ticker: "AAPL", shares: "5.000000", avgCostBasis: "142.5000" }
    );

    vi.mocked(db.transaction).mockImplementation(async (fn: any) => {
      await fn(tx);
    });

    await executeTrade({
      portfolioId: "p1",
      ticker: "AAPL",
      type: "SELL",
      shares: 5,
      userId: "u1",
      price: 200,
    });

    // Holding fully sold → delete was called
    expect(tx.delete).toHaveBeenCalled();

    const insertCall = transactionInsert(tx);
    expect(insertCall.costBasisAtSale).toBe("142.5000");
  });
});

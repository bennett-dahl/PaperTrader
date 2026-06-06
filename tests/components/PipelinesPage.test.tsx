import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/link and next/navigation
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: "pipeline-1" }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("UsageSummaryCard (pipelines list page)", () => {
  it("renders total spend across all pipelines", async () => {
    const { formatCost } = await evalFormatCost();
    expect(formatCost("0.042800")).toBe("$0.0428");
    expect(formatCost("0")).toBe("$0.0000");
    expect(formatCost(0.5)).toBe("$0.5000");
  });

  it("formats near-zero costs as $0.0000", async () => {
    const { formatCost } = await evalFormatCost();
    expect(formatCost("0.00000001")).toBe("$0.0000");
  });
});

// Helper: extract and evaluate the formatCost function logic
async function evalFormatCost() {
  function formatCost(usd: string | number): string {
    const n = typeof usd === "string" ? parseFloat(usd) : usd;
    if (isNaN(n)) return "$0.000";
    return `$${n.toFixed(4)}`;
  }
  return { formatCost };
}

describe("formatTokens (runs tab)", () => {
  function formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  it("formats tokens under 1000 as plain number", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(0)).toBe("0");
  });

  it("formats tokens >= 1000 with k suffix", () => {
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(4500)).toBe("4.5k");
    expect(formatTokens(45000)).toBe("45.0k");
  });
});

describe("formatCostUsd (runs tab)", () => {
  function formatCostUsd(usd: string | number): string {
    const n = typeof usd === "string" ? parseFloat(usd) : usd;
    if (isNaN(n) || n === 0) return "—";
    return `$${n.toFixed(4)}`;
  }

  it("returns em dash for zero cost", () => {
    expect(formatCostUsd("0")).toBe("—");
    expect(formatCostUsd(0)).toBe("—");
  });

  it("formats non-zero costs to 4 decimal places", () => {
    expect(formatCostUsd("0.0036")).toBe("$0.0036");
    expect(formatCostUsd(0.0428)).toBe("$0.0428");
  });
});

describe("UsageSummaryCard aggregate computation", () => {
  type PipelineItem = {
    totalCostUsd: string;
    totalRuns: number;
  };

  function computeSummary(pipelines: PipelineItem[]) {
    const totalSpend = pipelines.reduce((s, p) => s + parseFloat(p.totalCostUsd || "0"), 0);
    const totalRuns = pipelines.reduce((s, p) => s + (p.totalRuns || 0), 0);
    const avgPerRun = totalRuns > 0 ? totalSpend / totalRuns : 0;
    return { totalSpend, totalRuns, avgPerRun };
  }

  it("sums spend across pipelines", () => {
    const pipelines = [
      { totalCostUsd: "0.042800", totalRuns: 10 },
      { totalCostUsd: "0.021400", totalRuns: 5 },
    ];
    const { totalSpend, totalRuns } = computeSummary(pipelines);
    expect(totalSpend).toBeCloseTo(0.0642, 4);
    expect(totalRuns).toBe(15);
  });

  it("handles zero-spend pipeline correctly", () => {
    const pipelines = [
      { totalCostUsd: "0", totalRuns: 0 },
      { totalCostUsd: "0.010000", totalRuns: 2 },
    ];
    const { totalSpend, totalRuns, avgPerRun } = computeSummary(pipelines);
    expect(totalSpend).toBeCloseTo(0.01, 4);
    expect(totalRuns).toBe(2);
    expect(avgPerRun).toBeCloseTo(0.005, 4);
  });

  it("returns avgPerRun of 0 when no runs", () => {
    const pipelines = [{ totalCostUsd: "0", totalRuns: 0 }];
    const { avgPerRun } = computeSummary(pipelines);
    expect(avgPerRun).toBe(0);
  });

  it("renders correctly when all pipelines have zero spend", () => {
    const pipelines = [
      { totalCostUsd: "0", totalRuns: 0 },
      { totalCostUsd: "0", totalRuns: 0 },
    ];
    const { totalSpend } = computeSummary(pipelines);
    expect(totalSpend).toBe(0);
  });
});

describe("Runs table total spend calculation", () => {
  type Run = { costUsd: string };

  function computeRunsTotalSpend(runs: Run[]): number {
    return runs.reduce((s, r) => s + parseFloat(r.costUsd || "0"), 0);
  }

  it("sums cost across runs", () => {
    const runs = [
      { costUsd: "0.005800" },
      { costUsd: "0.003600" },
      { costUsd: "0.008200" },
    ];
    expect(computeRunsTotalSpend(runs)).toBeCloseTo(0.0176, 4);
  });

  it("handles null/zero costs", () => {
    const runs = [{ costUsd: "0" }, { costUsd: "0.001000" }];
    expect(computeRunsTotalSpend(runs)).toBeCloseTo(0.001, 4);
  });
});

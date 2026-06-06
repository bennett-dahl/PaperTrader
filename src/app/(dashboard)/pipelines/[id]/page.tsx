"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Play, CheckCircle, XCircle, MinusCircle, ChevronDown } from "lucide-react";

interface PipelineDetail {
  pipeline: Record<string, unknown>;
  template: Record<string, unknown> | null;
  portfolios: Array<{ portfolio: Record<string, unknown>; allocationPct: string }>;
  recentRuns: Array<Record<string, unknown>>;
}

interface Run {
  id: string;
  status: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  tickersEvaluated: number;
  tradesExecuted: number;
  tradesSkipped: number;
  tradesFailed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCostUsd(usd: string | number): string {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  if (isNaN(n) || n === 0) return "—";
  return `$${n.toFixed(4)}`;
}

interface Decision {
  id: string;
  ticker: string;
  action: string;
  confidence: string | null;
  shares: string | null;
  priceAtDecision: string | null;
  reasoning: string;
  executed: boolean;
  executionError: string | null;
  portfolioId: string | null;
}

const ACTION_COLORS: Record<string, string> = {
  BUY: "text-green-400 bg-green-400/10",
  SELL: "text-red-400 bg-red-400/10",
  HOLD: "text-blue-400 bg-blue-400/10",
  SKIP: "text-slate-400 bg-slate-700",
};

function RunStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle className="h-4 w-4 text-green-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-yellow-400" />;
  if (status === "running") return <div className="h-4 w-4 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />;
  return <span className="text-slate-400 text-xs">{status}</span>;
}

type Tab = "overview" | "runs" | "decisions" | "settings";

export default function PipelineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<PipelineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decisions tab state
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [id]);

  useEffect(() => {
    if (tab === "decisions" && data?.recentRuns?.length) {
      const firstRun = (data.recentRuns[0] as unknown as Run);
      if (!selectedRunId && firstRun?.id) {
        setSelectedRunId(firstRun.id);
      }
    }
  }, [tab, data]);

  useEffect(() => {
    if (selectedRunId) fetchDecisions(selectedRunId);
  }, [selectedRunId]);

  async function fetchData() {
    setLoading(true);
    const res = await fetch(`/api/pipelines/${id}`);
    if (!res.ok) { router.push("/pipelines"); return; }
    const d = await res.json();
    setData(d);
    setLoading(false);
  }

  async function fetchDecisions(runId: string) {
    setDecisionsLoading(true);
    const res = await fetch(`/api/pipelines/${id}/runs/${runId}/decisions`);
    const d = await res.json();
    setDecisions(d.decisions ?? []);
    setDecisionsLoading(false);
  }

  async function handleTrigger() {
    setTriggering(true);
    setError(null);
    const res = await fetch(`/api/pipelines/${id}/trigger`, { method: "POST" });
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Failed to trigger");
    }
    setTriggering(false);
  }

  async function handleDelete() {
    if (!confirm("Delete this pipeline? This cannot be undone.")) return;
    const res = await fetch(`/api/pipelines/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/pipelines");
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto animate-pulse space-y-4">
        <div className="h-8 bg-slate-800 rounded w-1/3" />
        <div className="h-64 bg-slate-900 rounded-xl" />
      </div>
    );
  }

  if (!data) return null;
  const pipeline = data.pipeline as Record<string, unknown>;
  const runs = (data.recentRuns ?? []) as unknown[] as Run[];

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "runs", label: "Run History" },
    { key: "decisions", label: "Decision Log" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/pipelines" className="text-slate-400 hover:text-slate-200 text-sm">Pipelines</Link>
            <span className="text-slate-600">/</span>
            <h1 className="text-2xl font-bold text-slate-100">{String(pipeline.name)}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              pipeline.status === "active" ? "text-green-400 bg-green-400/10" :
              pipeline.status === "paused" ? "text-yellow-400 bg-yellow-400/10" :
              "text-slate-400 bg-slate-400/10"
            }`}>
              {String(pipeline.status)}
            </span>
          </div>
          <p className="text-slate-400 text-sm line-clamp-1">{String(pipeline.thesis ?? "")}</p>
        </div>
        <button
          onClick={handleTrigger}
          disabled={triggering || pipeline.status !== "active"}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          <Play className="h-4 w-4" />
          {triggering ? "Queuing..." : "Run Now"}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              tab === t.key
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6">
            <h2 className="font-semibold text-slate-100 mb-4">Configuration</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                ["Strategy Type", String(pipeline.strategyType ?? "").replace("_", " ")],
                ["Max Positions", String(pipeline.maxPositions ?? "")],
                ["Max Position %", `${pipeline.maxPositionPct}%`],
                ["Min Cash Reserve %", `${pipeline.minCashReservePct}%`],
                ["Confidence Threshold", String(pipeline.minConfidenceThreshold ?? "")],
                ["Earnings Lookback", `${pipeline.earningsLookbackDays}d`],
                ["Earnings Forward", `${pipeline.earningsForwardDays}d`],
                ["Autonomous", String(pipeline.autonomous) === "true" ? "Yes" : "No"],
              ].map(([label, val]) => (
                <div key={label}>
                  <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                  <p className="text-sm text-slate-200 capitalize">{val}</p>
                </div>
              ))}
            </div>
            {Array.isArray(pipeline.tickerUniverse) && (pipeline.tickerUniverse as string[]).length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-slate-500 mb-1">Ticker Universe</p>
                <div className="flex flex-wrap gap-1.5">
                  {(pipeline.tickerUniverse as string[]).map((t) => (
                    <span key={t} className="px-2 py-0.5 bg-slate-700 text-slate-300 text-xs rounded">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {data.template && (
            <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6">
              <h2 className="font-semibold text-slate-100 mb-2">Template</h2>
              <p className="text-slate-300">{String((data.template as Record<string, unknown>).name)}</p>
              {Array.isArray(pipeline.configOverrides) && (pipeline.configOverrides as string[]).length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-slate-500">Overridden fields: {(pipeline.configOverrides as string[]).join(", ")}</p>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6">
            <h2 className="font-semibold text-slate-100 mb-4">Assigned Portfolios</h2>
            {data.portfolios.length === 0 ? (
              <p className="text-slate-400 text-sm">No portfolios assigned.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                    <th className="pb-2">Portfolio</th>
                    <th className="pb-2">Allocation %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.portfolios.map(({ portfolio, allocationPct }) => (
                    <tr key={String((portfolio as Record<string, unknown>).id)} className="border-t border-slate-800">
                      <td className="py-2 text-slate-200">{String((portfolio as Record<string, unknown>).name)}</td>
                      <td className="py-2 text-slate-400">{allocationPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Run History */}
      {tab === "runs" && (
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden">
          {runs.length === 0 ? (
            <div className="p-8 text-center text-slate-400">No runs yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800">
                <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Triggered</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Evaluated</th>
                  <th className="px-4 py-3">Executed</th>
                  <th className="px-4 py-3">Skipped</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Tokens</th>
                  <th className="px-4 py-3">Cost</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RunStatusIcon status={run.status} />
                        <span className="text-slate-300 capitalize">{run.status}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{run.triggeredBy}</td>
                    <td className="px-4 py-3 text-slate-400">{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-300">{run.tickersEvaluated}</td>
                    <td className="px-4 py-3 text-green-400">{run.tradesExecuted}</td>
                    <td className="px-4 py-3 text-slate-400">{run.tradesSkipped}</td>
                    <td className="px-4 py-3 text-slate-400">{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="px-4 py-3 text-slate-400">{formatTokens((run.inputTokens ?? 0) + (run.outputTokens ?? 0))}</td>
                    <td className="px-4 py-3 text-slate-300">{formatCostUsd(run.costUsd ?? "0")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {runs.length > 0 && (() => {
            const totalSpend = runs.reduce((s, r) => s + parseFloat(r.costUsd || "0"), 0);
            return totalSpend > 0 ? (
              <div className="px-4 py-3 border-t border-slate-700 text-sm text-slate-400 flex gap-1">
                <span>Total spend:</span>
                <span className="text-slate-200 font-medium">{formatCostUsd(totalSpend)}</span>
              </div>
            ) : null;
          })()}
        </div>
      )}

      {/* Decision Log */}
      {tab === "decisions" && (
        <div>
          {runs.length > 0 && (
            <div className="mb-4">
              <select
                value={selectedRunId ?? ""}
                onChange={(e) => setSelectedRunId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.startedAt).toLocaleString()} — {r.status}
                  </option>
                ))}
              </select>
            </div>
          )}
          {decisionsLoading ? (
            <div className="bg-slate-900 rounded-xl p-8 text-center text-slate-400 animate-pulse">Loading decisions...</div>
          ) : decisions.length === 0 ? (
            <div className="bg-slate-900 rounded-xl p-8 text-center text-slate-400">No decisions for this run.</div>
          ) : (
            <div className="bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-800">
                  <tr className="text-left text-slate-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3">Ticker</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Executed</th>
                    <th className="px-4 py-3">Note</th>
                    <th className="px-4 py-3">Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} className="border-t border-slate-800">
                      <td className="px-4 py-3 font-mono text-slate-200">{d.ticker}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[d.action] ?? ""}`}>
                          {d.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{d.confidence ? `${(parseFloat(d.confidence) * 100).toFixed(0)}%` : "—"}</td>
                      <td className="px-4 py-3">
                        {d.executed ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : (
                          <XCircle className="h-4 w-4 text-slate-500" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{d.executionError ?? "—"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedReasoning(expandedReasoning === d.id ? null : d.id)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                        >
                          View <ChevronDown className={`h-3 w-3 transition-transform ${expandedReasoning === d.id ? "rotate-180" : ""}`} />
                        </button>
                        {expandedReasoning === d.id && (
                          <p className="mt-2 text-xs text-slate-300 max-w-xs">{d.reasoning}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      {tab === "settings" && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-6">
            <h2 className="font-semibold text-slate-100 mb-4">Status</h2>
            <div className="flex gap-3">
              {pipeline.status !== "active" && (
                <button
                  onClick={async () => {
                    await fetch(`/api/pipelines/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "active" }),
                    });
                    await fetchData();
                  }}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
                >
                  Activate
                </button>
              )}
              {pipeline.status === "active" && (
                <button
                  onClick={async () => {
                    await fetch(`/api/pipelines/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "paused" }),
                    });
                    await fetchData();
                  }}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm"
                >
                  Pause
                </button>
              )}
            </div>
          </div>
          <div className="bg-slate-900 border border-red-900/30 rounded-xl p-6">
            <h2 className="font-semibold text-red-400 mb-2">Danger Zone</h2>
            <p className="text-sm text-slate-400 mb-4">Pipelines with run history will be archived instead of deleted.</p>
            <button
              onClick={handleDelete}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
            >
              Delete Pipeline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

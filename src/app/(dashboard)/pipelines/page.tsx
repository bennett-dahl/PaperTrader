"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Play, Pause, Archive, CheckCircle, XCircle, MinusCircle, Zap } from "lucide-react";

interface PipelineListItem {
  id: string;
  name: string;
  status: "active" | "paused" | "archived";
  strategyType: string;
  portfolioCount: number;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  thesis: string;
  autonomous: boolean;
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

const STATUS_STYLES = {
  active: "text-green-400 bg-green-400/10",
  paused: "text-yellow-400 bg-yellow-400/10",
  archived: "text-slate-400 bg-slate-400/10",
};

function RunStatusIcon({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-500">—</span>;
  if (status === "completed") return <CheckCircle className="h-4 w-4 text-green-400" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "skipped") return <MinusCircle className="h-4 w-4 text-yellow-400" />;
  return <span className="text-slate-400 text-xs">{status}</span>;
}

function formatCost(usd: string | number): string {
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  if (isNaN(n)) return "$0.000";
  return `$${n.toFixed(4)}`;
}

function UsageSummaryCard({ pipelines }: { pipelines: PipelineListItem[] }) {
  const totalSpend = pipelines.reduce((s, p) => s + parseFloat(p.totalCostUsd || "0"), 0);
  const totalRuns = pipelines.reduce((s, p) => s + (p.totalRuns || 0), 0);
  const avgPerRun = totalRuns > 0 ? totalSpend / totalRuns : 0;

  return (
    <div className="mb-6 glass rounded-xl p-4 flex items-center gap-6">
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">AI Pipeline Spend — all time</p>
        <div className="flex items-baseline gap-4 flex-wrap">
          <span className="text-xl font-semibold text-slate-100">{formatCost(totalSpend)}</span>
          <span className="text-sm text-slate-400">{totalRuns} run{totalRuns !== 1 ? "s" : ""}</span>
          {totalRuns > 0 && (
            <span className="text-sm text-slate-400">avg {formatCost(avgPerRun)} / run</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active" | "paused" | "archived">("all");
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPipelines();
  }, []);

  async function fetchPipelines() {
    setLoading(true);
    const res = await fetch("/api/pipelines");
    const data = await res.json();
    setPipelines(data.pipelines ?? []);
    setLoading(false);
  }

  async function handleTrigger(id: string) {
    setTriggering(id);
    setError(null);
    try {
      const res = await fetch(`/api/pipelines/${id}/trigger`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to trigger pipeline");
      }
    } finally {
      setTriggering(null);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    await fetch(`/api/pipelines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await fetchPipelines();
  }

  const filtered = pipelines.filter((p) => filter === "all" || p.status === filter);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">AI Pipelines</h1>
          <p className="text-slate-400 mt-1">Autonomous trading strategies</p>
        </div>
        <Link
          href="/pipelines/new"
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Pipeline
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-100">✕</button>
        </div>
      )}

      <UsageSummaryCard pipelines={pipelines} />

      <div className="flex gap-2 mb-6">
        {(["all", "active", "paused", "archived"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
              filter === f
                ? "bg-white/10 text-slate-100"
                : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white/5 rounded-xl p-6 animate-pulse">
              <div className="h-5 bg-white/10 rounded w-1/3 mb-2" />
              <div className="h-4 bg-white/5 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Zap className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No pipelines yet.</p>
          <Link href="/pipelines/new" className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm">
            Create your first pipeline →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="glass rounded-xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Link
                      href={`/pipelines/${p.id}`}
                      className="font-semibold text-slate-100 hover:text-indigo-300 transition-colors"
                    >
                      {p.name}
                    </Link>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[p.status]}`}>
                      {p.status}
                    </span>
                    {p.autonomous && (
                      <span className="text-xs px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full">
                        autonomous
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-1 mb-3">{p.thesis}</p>
                  <div className="flex items-center gap-4 text-xs text-slate-500 mb-1.5">
                    <span>{p.strategyType.replace("_", " ")}</span>
                    <span>{p.portfolioCount} portfolio{p.portfolioCount !== 1 ? "s" : ""}</span>
                    <span className="flex items-center gap-1">
                      <RunStatusIcon status={p.lastRunStatus} />
                      {p.lastRunAt ? new Date(p.lastRunAt).toLocaleDateString() : "Never run"}
                    </span>
                  </div>
                  {parseFloat(p.totalCostUsd || "0") > 0 && (
                    <div className="text-xs text-slate-500">
                      Cumulative spend: <span className="text-slate-400 font-medium">{formatCost(p.totalCostUsd)}</span>
                      <span className="ml-2 text-slate-600">·</span>
                      <span className="ml-2">{p.totalRuns} run{p.totalRuns !== 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => handleTrigger(p.id)}
                    disabled={triggering === p.id || p.status !== "active"}
                    title="Run now"
                    className="p-2 text-slate-400 hover:text-green-400 hover:bg-green-400/10 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    <Play className="h-4 w-4" />
                  </button>
                  {p.status === "active" ? (
                    <button
                      onClick={() => handleStatusChange(p.id, "paused")}
                      title="Pause"
                      className="p-2 text-slate-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded-lg transition-colors"
                    >
                      <Pause className="h-4 w-4" />
                    </button>
                  ) : p.status === "paused" ? (
                    <button
                      onClick={() => handleStatusChange(p.id, "active")}
                      title="Activate"
                      className="p-2 text-slate-400 hover:text-green-400 hover:bg-green-400/10 rounded-lg transition-colors"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                  ) : null}
                  <Link
                    href={`/pipelines/${p.id}`}
                    className="p-2 text-slate-400 hover:text-slate-100 hover:bg-white/5 rounded-lg transition-colors text-xs"
                  >
                    View →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

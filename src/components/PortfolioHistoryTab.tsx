"use client";

import { useEffect, useState } from "react";
import { TransactionRow } from "@/types/transactions";
import { cn } from "@/lib/utils";

interface Props {
  portfolioId: string;
}

// ─── Date grouping helpers ────────────────────────────────────────────────────

function getGroupLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface TransactionGroup {
  label: string;
  rows: TransactionRow[];
}

function groupByDate(rows: TransactionRow[]): TransactionGroup[] {
  const groups = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const label = getGroupLabel(new Date(row.executedAt));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(row);
  }
  return Array.from(groups.entries()).map(([label, rows]) => ({ label, rows }));
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PortfolioHistoryTab({ portfolioId }: Props) {
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/portfolios/${portfolioId}/transactions`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load history");
        return res.json();
      })
      .then((data: TransactionRow[]) => setTransactions(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-slate-400 text-sm">Loading history…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <p className="text-slate-400">No trades yet</p>
        <p className="text-slate-500 text-sm mt-1">
          Trades will appear here after your first buy or sell.
        </p>
      </div>
    );
  }

  const groups = groupByDate(transactions);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {group.label}
          </h3>
          <div className="space-y-2">
            {group.rows.map((tx) => (
              <TransactionRowItem key={tx.id} tx={tx} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Row item ─────────────────────────────────────────────────────────────────

function TransactionRowItem({ tx }: { tx: TransactionRow }) {
  const shares = parseFloat(tx.shares);
  const price = parseFloat(tx.pricePerShare);
  const total = parseFloat(tx.totalAmount);

  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4">
      {/* BUY/SELL badge */}
      <span
        className={cn(
          "text-xs font-bold px-2 py-1 rounded-md shrink-0",
          tx.type === "BUY"
            ? "bg-emerald-500/20 text-emerald-400"
            : "bg-red-500/20 text-red-400"
        )}
      >
        {tx.type}
      </span>

      {/* Ticker + detail */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-white">{tx.ticker}</span>
          <span className="text-slate-400 text-sm">
            {shares % 1 === 0 ? shares.toFixed(0) : shares.toFixed(4)} shares @ $
            {price.toFixed(2)}
          </span>
        </div>
        <div className="mt-1">
          {tx.pipelineName ? (
            <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">
              {tx.pipelineName}
            </span>
          ) : (
            <span className="text-xs text-slate-500">Manual</span>
          )}
        </div>
      </div>

      {/* Total + time */}
      <div className="text-right shrink-0">
        <div className="font-medium text-white">
          $
          {total.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
        <div className="text-xs text-slate-500">
          {new Date(tx.executedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

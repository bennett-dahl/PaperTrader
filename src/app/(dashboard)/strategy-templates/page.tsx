"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Edit, GitBranch } from "lucide-react";
import type { StrategyTemplate } from "@/db/schema";

export default function StrategyTemplatesPage() {
  const [templates, setTemplates] = useState<StrategyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [formData, setFormData] = useState({ name: "", description: "", thesis: "" });
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTemplates();
  }, []);

  async function fetchTemplates() {
    setLoading(true);
    const res = await fetch("/api/strategy-templates");
    const data = await res.json();
    setTemplates(data.templates ?? []);
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/strategy-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create template");
        return;
      }
      setShowCreate(false);
      setFormData({ name: "", description: "", thesis: "" });
      await fetchTemplates();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/strategy-templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Cannot delete template");
      setDeleteConfirm(null);
      return;
    }
    setDeleteConfirm(null);
    await fetchTemplates();
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Strategy Templates</h1>
          <p className="text-slate-400 mt-1">Reusable investment strategy configurations</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-100">✕</button>
        </div>
      )}

      {showCreate && (
        <div className="mb-6 glass rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Create Template</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Name *</label>
              <input
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Earnings Beat Momentum"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
              <input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Brief description..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Investment Thesis *</label>
              <textarea
                required
                rows={4}
                value={formData.thesis}
                onChange={(e) => setFormData({ ...formData, thesis: e.target.value })}
                className="w-full glass rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                placeholder="Describe the investment thesis in natural language..."
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {saving ? "Creating..." : "Create Template"}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreate(false); setFormData({ name: "", description: "", thesis: "" }); }}
                className="px-4 py-2 bg-white/10 hover:bg-slate-600 text-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white/5 rounded-xl p-6 animate-pulse">
              <div className="h-5 bg-white/10 rounded w-1/3 mb-2" />
              <div className="h-4 bg-white/5 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No templates yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.id} className="glass rounded-xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-slate-100">{t.name}</h3>
                    <span className="text-xs px-2 py-0.5 bg-white/10 text-slate-300 rounded-full">
                      {t.strategyType.replace("_", " ")}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-sm text-slate-400 mb-2">{t.description}</p>
                  )}
                  <p className="text-sm text-slate-500 line-clamp-2">{t.thesis}</p>
                  <p className="text-xs text-slate-600 mt-2">
                    Updated {new Date(t.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => setDeleteConfirm(t.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {deleteConfirm === t.id && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-400 mb-2">Delete this template?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="px-3 py-1.5 bg-white/10 hover:bg-slate-600 text-slate-100 text-sm rounded-lg"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

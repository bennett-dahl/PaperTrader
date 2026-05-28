"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Trash2, X, Plus, Save } from "lucide-react";

interface Preset {
  id: string;
  name: string;
  riskLevel: "low" | "medium" | "high";
  investAmount: string;
  categories: string[];
  stockCount: number;
  createdAt: string;
}

interface PresetsPanelProps {
  onApply: (preset: {
    riskLevel: "low" | "medium" | "high";
    investAmount: string;
    categories: string[];
    stockCount: number;
  }) => void;
  onClose: () => void;
  /** Current config to save as a new preset */
  currentConfig?: {
    riskLevel: "low" | "medium" | "high";
    investAmount: number;
    categories: string[];
    stockCount: number;
  };
}

const RISK_LABELS = { low: "Conservative", medium: "Balanced", high: "Aggressive" };
const RISK_COLORS = { low: "text-emerald-400", medium: "text-amber-400", high: "text-red-400" };

export default function PresetsPanel({ onApply, onClose, currentConfig }: PresetsPanelProps) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      setPresets(data.presets ?? []);
    } catch {
      toast.error("Failed to load presets");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!savingName.trim()) {
      toast.error("Enter a preset name");
      return;
    }
    if (!currentConfig) return;

    setSaving(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: savingName.trim(),
          riskLevel: currentConfig.riskLevel,
          investAmount: currentConfig.investAmount,
          categories: currentConfig.categories,
          stockCount: currentConfig.stockCount,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to save preset");
        return;
      }

      setPresets((prev) => [...prev, data.preset]);
      setSavingName("");
      setShowSaveForm(false);
      toast.success("Preset saved!");
    } catch {
      toast.error("Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });

      if (!res.ok) {
        toast.error("Failed to delete preset");
        return;
      }

      setPresets((prev) => prev.filter((p) => p.id !== id));
      toast.success("Preset deleted");
    } catch {
      toast.error("Failed to delete preset");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="font-semibold text-sm">Saved Presets</p>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white transition-colors p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 text-slate-400 animate-spin" />
        </div>
      )}

      {/* Presets list */}
      {!loading && presets.length === 0 && !showSaveForm && (
        <p className="text-slate-500 text-sm text-center py-3">
          No presets yet. Save your current config to reuse it later.
        </p>
      )}

      {!loading && presets.length > 0 && (
        <div className="space-y-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center justify-between bg-slate-800 rounded-xl px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{preset.name}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                  <span className={RISK_COLORS[preset.riskLevel]}>
                    {RISK_LABELS[preset.riskLevel]}
                  </span>
                  <span>·</span>
                  <span>${parseFloat(preset.investAmount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                  <span>·</span>
                  <span>{preset.stockCount} stocks</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onApply(preset)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 h-7 px-2"
                >
                  Apply
                </Button>
                <button
                  onClick={() => handleDelete(preset.id)}
                  disabled={deletingId === preset.id}
                  className="text-slate-600 hover:text-red-400 transition-colors p-1 disabled:opacity-50"
                >
                  {deletingId === preset.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save current config form */}
      {currentConfig && !showSaveForm && (
        <button
          onClick={() => setShowSaveForm(true)}
          className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors w-full py-2"
        >
          <Plus className="h-4 w-4" />
          Save current config as preset
        </button>
      )}

      {currentConfig && showSaveForm && (
        <div className="space-y-2">
          <Input
            placeholder="Preset name (e.g. My Tech Portfolio)"
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="bg-slate-800 border-slate-700 text-white text-sm h-9"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 h-8 flex-1"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (
                <>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Save
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowSaveForm(false); setSavingName(""); }}
              className="text-slate-400 h-8"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

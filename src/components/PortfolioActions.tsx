"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, DollarSign, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface PortfolioActionsProps {
  portfolioId: string;
  portfolioName: string;
  cashBalance: number;
  holdingsCount: number;
  isDefault: boolean;
}

export default function PortfolioActions({
  portfolioId,
  portfolioName,
  cashBalance,
  holdingsCount,
}: PortfolioActionsProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState(portfolioName);
  const [newCash, setNewCash] = useState(String(cashBalance));
  const router = useRouter();

  const handleRename = async () => {
    if (!newName.trim() || newName.trim() === portfolioName) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) { toast.error("Failed to rename portfolio"); return; }
      toast.success("Portfolio renamed");
      setRenameOpen(false);
      router.refresh();
    } catch { toast.error("Something went wrong"); }
    finally { setLoading(false); }
  };

  const handleAdjustCash = async () => {
    const amount = parseFloat(newCash);
    if (isNaN(amount) || amount < 0) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashBalance: amount }),
      });
      if (!res.ok) { toast.error("Failed to update cash balance"); return; }
      toast.success("Cash balance updated");
      setCashOpen(false);
      router.refresh();
    } catch { toast.error("Something went wrong"); }
    finally { setLoading(false); }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/${portfolioId}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Failed to delete portfolio"); return; }
      toast.success("Portfolio deleted");
      setDeleteOpen(false);
      router.refresh();
    } catch { toast.error("Something went wrong"); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="flex items-center gap-2 pt-1 border-t border-glass-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setNewName(portfolioName); setRenameOpen(true); }}
          className="text-slate-400 hover:text-white text-xs gap-1.5 h-8 px-3"
        >
          <Pencil className="h-3.5 w-3.5" /> Rename
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setNewCash(String(cashBalance)); setCashOpen(true); }}
          className="text-slate-400 hover:text-white text-xs gap-1.5 h-8 px-3"
        >
          <DollarSign className="h-3.5 w-3.5" /> Add Cash
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDeleteOpen(true)}
          className="ml-auto text-slate-600 hover:text-red-400 text-xs gap-1.5 h-8 px-3"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="bg-popover backdrop-blur-xl border-glass-border text-white">
          <DialogHeader><DialogTitle>Rename Portfolio</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              placeholder="Portfolio name"
              className="bg-white/5 border-glass-border text-white"
            />
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRenameOpen(false)} className="flex-1">Cancel</Button>
              <Button
                onClick={handleRename}
                disabled={loading || !newName.trim() || newName.trim() === portfolioName}
                className="flex-1 bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow font-bold"
              >
                {loading ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Adjust Cash Dialog */}
      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent className="bg-popover backdrop-blur-xl border-glass-border text-white">
          <DialogHeader><DialogTitle>Adjust Cash Balance</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-slate-400 text-sm">
              This updates your available cash. Your starting balance is used for ROI calculations and won&apos;t change.
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
              <Input
                type="number"
                min={0}
                step={100}
                value={newCash}
                onChange={(e) => setNewCash(e.target.value)}
                className="bg-white/5 border-glass-border text-white pl-7"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setCashOpen(false)} className="flex-1">Cancel</Button>
              <Button
                onClick={handleAdjustCash}
                disabled={loading || newCash === "" || parseFloat(newCash) < 0}
                className="flex-1 bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-glow font-bold"
              >
                {loading ? "Saving…" : "Update Cash"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="bg-popover backdrop-blur-xl border-glass-border text-white">
          <DialogHeader><DialogTitle>Delete Portfolio</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {holdingsCount > 0 ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <p className="text-red-400 text-sm font-medium mb-1">⚠️ Portfolio has holdings</p>
                <p className="text-slate-300 text-sm">
                  This portfolio has {holdingsCount} holding{holdingsCount !== 1 ? "s" : ""}.
                  Deleting it will permanently remove all data including trade history. This cannot be undone.
                </p>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">
                Are you sure you want to delete &quot;{portfolioName}&quot;? This cannot be undone.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDeleteOpen(false)} className="flex-1">Cancel</Button>
              <Button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold"
              >
                {loading ? "Deleting…" : "Delete Portfolio"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

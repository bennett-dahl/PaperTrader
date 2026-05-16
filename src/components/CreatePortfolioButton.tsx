"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function CreatePortfolioButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // userId is passed to identify the user context on the client,
  // but the actual auth check happens server-side in the API route
  void userId;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "Failed to create portfolio");
        return;
      }

      toast.success(`"${name.trim()}" created with $5,000!`);
      setName("");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button
          size="sm"
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold gap-1.5 min-h-[44px]"
        >
          <Plus className="h-4 w-4" />
          New Portfolio
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>Create New Portfolio</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-slate-400 text-sm">
            Each portfolio starts with $5,000 in virtual cash.
          </p>
          <Input
            placeholder="e.g. Value Picks, Tech Bets, Index Strategy"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="bg-slate-800 border-slate-700 text-white"
          />
          <Button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold"
          >
            {loading ? "Creating…" : "Create Portfolio"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

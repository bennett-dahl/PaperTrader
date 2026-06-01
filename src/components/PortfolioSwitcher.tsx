"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Portfolio {
  id: string;
  name: string;
}

interface PortfolioSwitcherProps {
  portfolios: Portfolio[];
  selectedId: string;
}

export default function PortfolioSwitcher({
  portfolios,
  selectedId,
}: PortfolioSwitcherProps) {
  const router = useRouter();

  if (portfolios.length === 0) {
    return (
      <Link
        href="/portfolios"
        className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        Create your first portfolio →
      </Link>
    );
  }

  if (portfolios.length === 1) {
    return (
      <Link
        href="/portfolios"
        className="text-xs text-slate-500 hover:text-slate-400 transition-colors"
      >
        ＋ New Portfolio
      </Link>
    );
  }

  return (
    <Select
      value={selectedId}
      onValueChange={(value) => {
        if (value === "__new__") {
          router.push("/portfolios");
        } else {
          router.push(`?portfolio=${value}`);
        }
      }}
    >
      <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-sm h-8 w-auto">
        <SelectValue>{portfolios.find((p) => p.id === selectedId)?.name ?? "Portfolio"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {portfolios.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
        <SelectItem value="__new__" className="text-slate-400 border-t border-slate-700 mt-1 pt-1">
          ＋ New Portfolio
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

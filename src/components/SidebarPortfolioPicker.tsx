"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActivePortfolio } from "@/contexts/ActivePortfolioContext";

interface SidebarPortfolioPickerProps {
  portfolios: { id: string; name: string }[];
}

const NEW_PORTFOLIO = "__new__";

export default function SidebarPortfolioPicker({
  portfolios,
}: SidebarPortfolioPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { activePortfolioId, setActivePortfolioId } = useActivePortfolio();

  if (portfolios.length === 0) return null;

  const active =
    portfolios.find((p) => p.id === activePortfolioId) ?? portfolios[0];

  function handleChange(value: string | null) {
    if (!value) return;
    if (value === NEW_PORTFOLIO) {
      router.push("/portfolios");
      return;
    }
    setActivePortfolioId(value);
    if (pathname === "/dashboard") router.push(`?portfolio=${value}`);
  }

  return (
    <Select value={active.id} onValueChange={handleChange}>
      <SelectTrigger
        aria-label="Active portfolio"
        className="h-9 w-full rounded-xl border-glass-border bg-white/5 text-sm text-slate-200"
      >
        <SelectValue>{active.name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {portfolios.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
        <SelectItem
          value={NEW_PORTFOLIO}
          className="mt-1 border-t border-glass-border pt-1 text-slate-400"
        >
          ＋ New portfolio
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

"use client";

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

  if (portfolios.length <= 1) return null;

  return (
    <Select
      value={selectedId}
      onValueChange={(value) => {
        router.push(`?portfolio=${value}`);
      }}
    >
      <SelectTrigger className="bg-slate-800 border-slate-700 text-slate-200 text-sm h-8 w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {portfolios.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

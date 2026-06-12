"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

interface SearchResult {
  symbol: string;
  description: string;
  type: string;
}

interface StockSearchProps {
  onSelect: (stock: { ticker: string; name: string }) => void;
}

export default function StockSearch({ onSelect }: StockSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim() || query.length < 1) {
      setResults([]);
      setOpen(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setResults(data.results ?? []);
        setOpen((data.results ?? []).length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <Input
          type="text"
          placeholder="Search by ticker or company name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="pl-10 bg-popover backdrop-blur-xl border-glass-border text-white h-12 min-h-[44px]"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 animate-spin" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 glass rounded-xl overflow-hidden z-50 shadow-xl">
          {results.map((result) => (
            <button
              key={result.symbol}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors text-left min-h-[44px]"
              onClick={() => {
                onSelect({ ticker: result.symbol, name: result.description });
                setQuery("");
                setOpen(false);
              }}
            >
              <div>
                <p className="font-semibold">{result.symbol}</p>
                <p className="text-slate-500 text-xs truncate max-w-[200px]">
                  {result.description}
                </p>
              </div>
              <span className="text-slate-600 text-xs">{result.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

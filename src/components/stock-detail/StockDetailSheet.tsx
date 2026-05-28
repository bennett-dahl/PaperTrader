"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Heart,
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  X,
  ExternalLink,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useActivePortfolio } from "@/contexts/ActivePortfolioContext";
import { useWatchlist } from "@/hooks/useWatchlist";
import { useSwipeToDismiss } from "@/hooks/useSwipeToDismiss";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StockDetailContext = "search" | "holdings" | "builder";

export interface HoldingData {
  shares: number;
  avgCost: number;
  portfolioId: string;
}

export interface StockDetailProps {
  ticker: string;
  stockName?: string;
  context: StockDetailContext;
  holding?: HoldingData;
  builderSlotIndex?: number;
  onSwapIn?: (ticker: string) => void;
  open: boolean;
  onClose: () => void;
}

interface StockDetailResponse {
  ticker: string;
  profile: {
    name: string | null;
    exchange: string | null;
    currency: string | null;
    logo: string | null;
    weburl: string | null;
    ipo: string | null;
    finnhubIndustry: string | null;
    country: string | null;
    marketCapitalization: number | null;
    shareOutstanding: number | null;
  } | null;
  fundamentals: {
    peRatioTTM: number | null;
    pbRatioQuarterly: number | null;
    epsTTM: number | null;
    dividendYieldIndicatedAnnual: number | null;
    revenuePerShareTTM: number | null;
    roeTTM: number | null;
    debtToEquityQuarterly: number | null;
    currentRatioQuarterly: number | null;
    netProfitMarginTTM: number | null;
    week52High: number | null;
    week52Low: number | null;
    week52HighDate: string | null;
    week52LowDate: string | null;
    beta: number | null;
  } | null;
  quote: {
    currentPrice: number | null;
    openPrice: number | null;
    highPrice: number | null;
    lowPrice: number | null;
    previousClose: number | null;
    change: number | null;
    changePercent: number | null;
    timestamp: number | null;
  } | null;
  fetchedAt: number;
}

interface CandlePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NewsItem {
  id: string | number;
  headline: string;
  source: string;
  url: string;
  image: string | null;
  datetime: number | null;
  summary: string | null;
}

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";
type LoadStatus = "idle" | "loading" | "success" | "error";
type SubmitStatus = "idle" | "submitting" | "success" | "error";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number | null | undefined, suffix = "%"): string {
  if (v == null) return "—";
  return `${v.toFixed(2)}${suffix}`;
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function fmtMarketCap(v: number | null | undefined): string {
  if (v == null) return "—";
  // v is in millions
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}T`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}B`;
  return `$${v.toFixed(0)}M`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return v;
  }
}

function fmtRelativeTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const diffMs = Date.now() - unixSeconds * 1000;
  const hours = Math.floor(diffMs / 3600000);
  if (hours < 1) {
    const mins = Math.floor(diffMs / 60000);
    return `${mins}m ago`;
  }
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function fmtCandleTime(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts);
  if (timeframe === "1D") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Stat grid helpers ────────────────────────────────────────────────────────

interface StatItem {
  label: string;
  value: string;
}

// ─── Drag handle ─────────────────────────────────────────────────────────────

function DragHandle() {
  return (
    <div className="flex justify-center pt-2 pb-1">
      <div className="w-10 h-1 rounded-full bg-slate-700" />
    </div>
  );
}

// ─── Position banner ─────────────────────────────────────────────────────────

function PositionBanner({
  holding,
  currentPrice,
}: {
  holding: HoldingData;
  currentPrice: number | null;
}) {
  const price = currentPrice ?? holding.avgCost;
  const pnl = (price - holding.avgCost) * holding.shares;
  const pnlPct =
    holding.avgCost > 0
      ? ((price - holding.avgCost) / holding.avgCost) * 100
      : 0;
  const isUp = pnl >= 0;

  return (
    <div className="mx-4 mb-3 bg-slate-800/60 border border-slate-700 rounded-xl px-4 py-2.5">
      <div className="flex items-center justify-between text-sm flex-wrap gap-2">
        <span className="text-slate-400">
          <span className="text-white font-semibold">
            {holding.shares % 1 === 0
              ? holding.shares.toFixed(0)
              : holding.shares.toFixed(4)}{" "}
            share{holding.shares !== 1 ? "s" : ""}
          </span>{" "}
          · Avg {fmtPrice(holding.avgCost)}
        </span>
        <span
          className={cn(
            "font-semibold text-sm",
            isUp ? "text-emerald-400" : "text-red-400"
          )}
        >
          {isUp ? "+" : ""}
          {fmtPrice(Math.abs(pnl))} ({isUp ? "+" : ""}
          {pnlPct.toFixed(1)}%)
        </span>
      </div>
    </div>
  );
}

// ─── Price chart ──────────────────────────────────────────────────────────────

interface ChartPoint {
  x: number;
  timestamp: number;
  close: number;
  label: string;
}

function buildChartData(candles: CandlePoint[], timeframe: Timeframe): ChartPoint[] {
  if (candles.length === 0) return [];
  return candles.map((c) => ({
    x: c.timestamp,
    timestamp: c.timestamp,
    close: c.close,
    label: fmtCandleTime(c.timestamp, timeframe),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point: ChartPoint = payload[0].payload;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 shadow-xl text-sm pointer-events-none">
      <p className="font-bold text-white">{fmtPrice(point.close)}</p>
      <p className="text-slate-400 text-xs">
        {new Date(point.timestamp).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

function PriceChartSection({
  ticker,
  quote,
  activeTimeframe,
  setActiveTimeframe,
  candleStatus,
  candleData,
  candleError,
  onRetry,
}: {
  ticker: string;
  quote: StockDetailResponse["quote"];
  activeTimeframe: Timeframe;
  setActiveTimeframe: (t: Timeframe) => void;
  candleStatus: LoadStatus;
  candleData: CandlePoint[];
  candleError: string | null;
  onRetry: () => void;
}) {
  const chartData = buildChartData(candleData, activeTimeframe);
  const isUp =
    chartData.length >= 2
      ? chartData[chartData.length - 1].close >= chartData[0].close
      : true;
  const chartColor = isUp ? "#10b981" : "#ef4444";
  const currentPrice = quote?.currentPrice;
  const changePercent = quote?.changePercent;
  const change = quote?.change;

  const TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "1Y"];

  return (
    <div className="px-4 mb-4">
      {/* Price header */}
      <div className="mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-white">
            {currentPrice != null ? fmtPrice(currentPrice) : "—"}
          </span>
          {changePercent != null && change != null && (
            <span
              className={cn(
                "text-sm font-semibold",
                changePercent >= 0 ? "text-emerald-400" : "text-red-400"
              )}
            >
              {changePercent >= 0 ? "+" : ""}
              {fmtPrice(change)} ({changePercent >= 0 ? "+" : ""}
              {fmtPct(changePercent)})
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs mt-0.5">{ticker}</p>
      </div>

      {/* Chart area */}
      <div className="h-36 w-full">
        {candleStatus === "loading" ? (
          <div className="h-full w-full bg-slate-800/40 rounded-xl animate-pulse" />
        ) : candleStatus === "error" ? (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <p className="text-slate-500 text-sm">{candleError ?? "Chart unavailable"}</p>
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-slate-500 text-sm">No trading data for this session</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <YAxis domain={["auto", "auto"]} hide />
              <Tooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="close"
                stroke={chartColor}
                strokeWidth={2}
                fill={`url(#grad-${ticker})`}
                dot={false}
                activeDot={{ r: 4, fill: chartColor, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Timeframe tabs */}
      <div className="flex gap-1 mt-2">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setActiveTimeframe(tf)}
            className={cn(
              "flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors",
              activeTimeframe === tf
                ? "bg-slate-700 text-white"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            {tf}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Key Stats ────────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-slate-800 last:border-0">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="text-white text-sm font-medium">{value}</span>
    </div>
  );
}

function KeyStatsSection({
  detail,
}: {
  detail: StockDetailResponse;
}) {
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const { quote, fundamentals, profile } = detail;

  const simpleStats: StatItem[] = [
    { label: "Current Price", value: fmtPrice(quote?.currentPrice) },
    {
      label: "Today's Change",
      value:
        quote?.change != null && quote?.changePercent != null
          ? `${quote.change >= 0 ? "+" : ""}${fmtPrice(quote.change)} (${quote.changePercent >= 0 ? "+" : ""}${fmtPct(quote.changePercent)})`
          : "—",
    },
    { label: "Open", value: fmtPrice(quote?.openPrice) },
    { label: "High", value: fmtPrice(quote?.highPrice) },
    { label: "Low", value: fmtPrice(quote?.lowPrice) },
    { label: "Prev Close", value: fmtPrice(quote?.previousClose) },
    { label: "52-Wk High", value: fmtPrice(fundamentals?.week52High) },
    { label: "52-Wk Low", value: fmtPrice(fundamentals?.week52Low) },
  ];

  const advancedExtra: StatItem[] = [
    { label: "Market Cap", value: fmtMarketCap(profile?.marketCapitalization) },
    { label: "P/E Ratio", value: fmtNum(fundamentals?.peRatioTTM, 1) },
    { label: "P/B Ratio", value: fmtNum(fundamentals?.pbRatioQuarterly, 1) },
    { label: "EPS (TTM)", value: fmtPrice(fundamentals?.epsTTM) },
    {
      label: "Div. Yield",
      value:
        fundamentals?.dividendYieldIndicatedAnnual != null
          ? fmtPct(fundamentals.dividendYieldIndicatedAnnual)
          : "—",
    },
    { label: "Beta", value: fmtNum(fundamentals?.beta) },
    {
      label: "ROE",
      value:
        fundamentals?.roeTTM != null ? fmtPct(fundamentals.roeTTM) : "—",
    },
    {
      label: "Net Margin",
      value:
        fundamentals?.netProfitMarginTTM != null
          ? fmtPct(fundamentals.netProfitMarginTTM)
          : "—",
    },
    { label: "D/E Ratio", value: fmtNum(fundamentals?.debtToEquityQuarterly) },
    {
      label: "Current Ratio",
      value: fmtNum(fundamentals?.currentRatioQuarterly),
    },
    { label: "Industry", value: profile?.finnhubIndustry ?? "—" },
    { label: "Exchange", value: profile?.exchange ?? "—" },
    { label: "IPO Date", value: fmtDate(profile?.ipo) },
  ];

  const stats = mode === "simple" ? simpleStats : [...simpleStats, ...advancedExtra];

  return (
    <div className="px-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300">Key Stats</h3>
        <div className="flex rounded-lg overflow-hidden border border-slate-700">
          <button
            onClick={() => setMode("simple")}
            className={cn(
              "px-3 py-1 text-xs font-medium transition-colors",
              mode === "simple"
                ? "bg-slate-700 text-white"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            Simple
          </button>
          <button
            onClick={() => setMode("advanced")}
            className={cn(
              "px-3 py-1 text-xs font-medium transition-colors",
              mode === "advanced"
                ? "bg-slate-700 text-white"
                : "text-slate-500 hover:text-slate-300"
            )}
          >
            Advanced
          </button>
        </div>
      </div>
      <div className="bg-slate-900 rounded-xl px-4 border border-slate-800">
        {stats.map((s) => (
          <StatRow key={s.label} label={s.label} value={s.value} />
        ))}
      </div>
    </div>
  );
}

// ─── News ─────────────────────────────────────────────────────────────────────

function NewsSection({ ticker }: { ticker: string }) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/stock/news/${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setNews(data.news ?? []);
          setStatus("success");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  return (
    <div className="px-4 mb-4">
      <h3 className="text-sm font-semibold text-slate-300 mb-3">News</h3>

      {status === "loading" && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 bg-slate-800/40 rounded-xl animate-pulse"
            />
          ))}
        </div>
      )}

      {status === "error" && (
        <p className="text-slate-500 text-sm text-center py-4">
          News temporarily unavailable
        </p>
      )}

      {status === "success" && news.length === 0 && (
        <p className="text-slate-500 text-sm text-center py-4">
          No recent news for {ticker}
        </p>
      )}

      {status === "success" && news.length > 0 && (
        <div className="space-y-2">
          {news.map((item) => (
            <button
              key={item.id}
              onClick={() => window.open(item.url, "_blank", "noopener")}
              className="w-full text-left bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 hover:border-slate-700 transition-colors"
            >
              <div className="flex gap-3">
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-slate-500 text-xs">{item.source}</span>
                    {item.datetime && (
                      <span className="text-slate-600 text-xs">
                        · {fmtRelativeTime(item.datetime)}
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3 text-slate-700 ml-auto flex-shrink-0" />
                  </div>
                  <p className="text-white text-sm font-medium line-clamp-2 leading-snug">
                    {item.headline}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Trade panel ──────────────────────────────────────────────────────────────

interface TradePanelProps {
  ticker: string;
  context: StockDetailContext;
  holding: HoldingData | null;
  currentPrice: number | null;
  detailReady: boolean;
  portfolioId: string | null;
  onSwapIn?: (ticker: string) => void;
  onClose: () => void;
  onTradeSuccess: (newShares: number, newAvgCost: number) => void;
}

function TradePanel({
  ticker,
  context,
  holding,
  currentPrice,
  detailReady,
  portfolioId,
  onSwapIn,
  onClose,
  onTradeSuccess,
}: TradePanelProps) {
  const [tradeMode, setTradeMode] = useState<"idle" | "buy" | "sell">("idle");
  const [sharesInput, setSharesInput] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [availableCash, setAvailableCash] = useState<number | null>(null);

  // Fetch available cash when trade form opens
  useEffect(() => {
    if (tradeMode === "idle" || !portfolioId) return;
    fetch(`/api/portfolio`)
      .then((r) => r.json())
      .then((data) => {
        const p = data.portfolios?.find(
          (p: { id: string; cashBalance: string }) => p.id === portfolioId
        );
        if (p) setAvailableCash(parseFloat(p.cashBalance));
      })
      .catch(() => {});
  }, [tradeMode, portfolioId]);

  const sharesNum = parseFloat(sharesInput);
  const estimatedTotal =
    !isNaN(sharesNum) && sharesNum > 0 && currentPrice != null
      ? sharesNum * currentPrice
      : null;

  // Validation
  let inputError: string | null = null;
  if (sharesInput && tradeMode !== "idle") {
    if (isNaN(sharesNum) || sharesInput.trim() === "") {
      inputError = "Enter a number of shares";
    } else if (sharesNum <= 0) {
      inputError = "Must be greater than zero";
    } else if (
      tradeMode === "buy" &&
      availableCash != null &&
      estimatedTotal != null &&
      estimatedTotal > availableCash
    ) {
      inputError = "Insufficient cash";
    } else if (tradeMode === "sell" && holding && sharesNum > holding.shares) {
      inputError = `You only hold ${holding.shares.toFixed(4)} shares`;
    }
  }

  const confirmDisabled =
    !sharesInput ||
    isNaN(sharesNum) ||
    sharesNum <= 0 ||
    !!inputError ||
    currentPrice == null ||
    submitStatus === "submitting";

  const handleConfirm = async () => {
    if (confirmDisabled || !portfolioId || tradeMode === "idle") return;
    setSubmitStatus("submitting");
    setTradeError(null);

    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          type: tradeMode === "buy" ? "BUY" : "SELL",
          shares: sharesNum,
          portfolioId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTradeError(data.error ?? "Trade failed");
        setSubmitStatus("error");
        return;
      }

      // Update live holding
      const trade = data.trade;
      const prevShares = holding?.shares ?? 0;
      const prevAvgCost = holding?.avgCost ?? 0;
      let newShares: number;
      let newAvgCost: number;

      if (tradeMode === "buy") {
        newShares = prevShares + sharesNum;
        newAvgCost =
          newShares > 0
            ? (prevShares * prevAvgCost + sharesNum * (trade?.pricePerShare ?? currentPrice!)) / newShares
            : currentPrice!;
      } else {
        newShares = Math.max(0, prevShares - sharesNum);
        newAvgCost = prevAvgCost; // avg cost unchanged on sell
      }

      onTradeSuccess(newShares, newAvgCost);
      setSubmitStatus("success");
      setTradeMode("idle");
      setSharesInput("");
      toast.success("Trade confirmed ✓");
    } catch {
      setTradeError("Something went wrong");
      setSubmitStatus("error");
    }
  };

  // Builder context
  if (context === "builder") {
    return (
      <div className="px-4 pb-4 pt-2">
        <Button
          disabled={!detailReady || !onSwapIn}
          onClick={() => {
            onSwapIn?.(ticker);
            onClose();
          }}
          className="w-full h-12 text-base font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-900 min-h-[44px]"
        >
          Swap In {ticker}
        </Button>
      </div>
    );
  }

  // Idle CTA
  if (tradeMode === "idle") {
    const hasHolding = !!holding;
    const showSell = context === "holdings" || hasHolding;

    return (
      <div className="px-4 pb-4 pt-2 flex gap-2">
        <Button
          disabled={!detailReady}
          onClick={() => setTradeMode("buy")}
          className="flex-1 h-12 text-base font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-900 min-h-[44px]"
        >
          Buy
        </Button>
        {showSell && (
          <Button
            disabled={!detailReady}
            onClick={() => setTradeMode("sell")}
            variant="outline"
            className="flex-1 h-12 text-base font-bold border-red-500/50 text-red-400 hover:bg-red-500/10 min-h-[44px]"
          >
            Sell
          </Button>
        )}
      </div>
    );
  }

  // Trade form
  return (
    <div className="px-4 pb-4 pt-2 bg-slate-900/80 border-t border-slate-800">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white capitalize">{tradeMode} {ticker}</h3>
        <button
          onClick={() => {
            setTradeMode("idle");
            setSharesInput("");
            setTradeError(null);
          }}
          className="text-slate-500 hover:text-white p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="0"
              min="0.0001"
              step="any"
              value={sharesInput}
              onChange={(e) => {
                setSharesInput(e.target.value);
                setTradeError(null);
              }}
              className="bg-slate-800 border-slate-700 text-white text-base h-11"
              autoFocus
            />
            <span className="text-slate-500 text-sm whitespace-nowrap">
              shares
            </span>
          </div>
          {currentPrice != null && (
            <p className="text-slate-500 text-xs mt-1">
              @ {fmtPrice(currentPrice)} each
            </p>
          )}
          {(inputError || tradeError) && (
            <p className="text-red-400 text-xs mt-1.5">
              {inputError ?? tradeError}
            </p>
          )}
        </div>

        {estimatedTotal != null && (
          <div className="bg-slate-800 rounded-xl px-4 py-2.5 flex justify-between items-center">
            <span className="text-slate-400 text-sm">Est. total</span>
            <span className="font-bold">
              {fmtPrice(estimatedTotal)}
            </span>
          </div>
        )}

        {availableCash != null && tradeMode === "buy" && (
          <p className="text-slate-500 text-xs text-right">
            Available: {fmtPrice(availableCash)}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setTradeMode("idle");
              setSharesInput("");
              setTradeError(null);
            }}
            className="flex-1 h-11 text-slate-400 hover:text-white min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            disabled={confirmDisabled}
            onClick={handleConfirm}
            className={cn(
              "flex-1 h-11 font-bold min-h-[44px]",
              tradeMode === "buy"
                ? "bg-emerald-500 hover:bg-emerald-400 text-slate-900"
                : "bg-red-500 hover:bg-red-400 text-white"
            )}
          >
            {submitStatus === "submitting" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Confirm ${tradeMode === "buy" ? "Buy" : "Sell"}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist heart ──────────────────────────────────────────────────────────

function WatchlistHeart({
  status,
  isToggling,
  onToggle,
}: {
  status: "loading" | "watching" | "not_watching" | "error";
  isToggling: boolean;
  onToggle: () => void;
}) {
  const disabled = status === "loading" || status === "error" || isToggling;
  const filled = status === "watching";

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "p-2 rounded-full transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-slate-800 active:scale-90"
      )}
      title={
        status === "error"
          ? "Watchlist unavailable"
          : filled
          ? "Remove from watchlist"
          : "Add to watchlist"
      }
    >
      <Heart
        className={cn(
          "h-5 w-5 transition-colors",
          filled ? "fill-red-500 text-red-500" : "text-slate-400"
        )}
      />
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StockDetailSheet({
  ticker,
  stockName,
  context,
  holding,
  onSwapIn,
  open,
  onClose,
}: StockDetailProps) {
  const { activePortfolioId } = useActivePortfolio();

  // Watchlist (portfolio-scoped)
  const {
    status: watchlistStatus,
    isToggling: watchlistToggling,
    toggle: toggleWatchlist,
  } = useWatchlist(ticker, activePortfolioId);

  // Swipe to dismiss
  const { dragY, onTouchStart, onTouchMove, onTouchEnd } =
    useSwipeToDismiss(onClose);

  // Detail data
  const [detailStatus, setDetailStatus] = useState<LoadStatus>("idle");
  const [detailData, setDetailData] = useState<StockDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Candles
  const [activeTimeframe, setActiveTimeframeState] = useState<Timeframe>("1D");
  const [candleStatus, setCandleStatus] = useState<LoadStatus>("idle");
  const [candleData, setCandleData] = useState<CandlePoint[]>([]);
  const [candleError, setCandleError] = useState<string | null>(null);

  // Live holding (overrides prop after trade)
  const [liveHolding, setLiveHolding] = useState<HoldingData | null>(
    holding ?? null
  );

  // Sync liveHolding when prop changes (e.g., sheet reopened with new holding)
  useEffect(() => {
    setLiveHolding(holding ?? null);
  }, [holding]);

  // On mount: if no holding prop, check active portfolio for existing position
  useEffect(() => {
    if (!holding && activePortfolioId && open) {
      // Could fetch holding data from portfolio API
      // For simplicity, we rely on the holder passing holding prop
    }
  }, [holding, activePortfolioId, open]);

  // Fetch detail data
  const fetchDetail = useCallback(async () => {
    if (!ticker) return;
    setDetailStatus("loading");
    setDetailError(null);
    try {
      const res = await fetch(`/api/stock-detail/${encodeURIComponent(ticker)}`);
      const data = await res.json();
      if (!res.ok) {
        setDetailError(data.error ?? "Failed to load stock data");
        setDetailStatus("error");
        return;
      }
      setDetailData(data);
      setDetailStatus("success");
    } catch {
      setDetailError("Failed to load stock data");
      setDetailStatus("error");
    }
  }, [ticker]);

  // Fetch candles
  const fetchCandles = useCallback(
    async (timeframe: Timeframe) => {
      if (!ticker) return;
      setCandleStatus("loading");
      setCandleError(null);
      try {
        const res = await fetch(
          `/api/stock/candles/${encodeURIComponent(ticker)}?timeframe=${timeframe}`
        );
        const data = await res.json();
        if (!res.ok) {
          setCandleError(data.error ?? "Chart unavailable");
          setCandleStatus("error");
          return;
        }
        setCandleData(data.candles ?? []);
        setCandleStatus("success");
      } catch {
        setCandleError("Chart unavailable");
        setCandleStatus("error");
      }
    },
    [ticker]
  );

  // Fire fetches when sheet opens
  useEffect(() => {
    if (!open || !ticker) return;
    setDetailStatus("idle");
    setDetailData(null);
    setCandleData([]);
    setActiveTimeframeState("1D");
    fetchDetail();
    fetchCandles("1D");
  }, [open, ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveTimeframe = (tf: Timeframe) => {
    setActiveTimeframeState(tf);
    fetchCandles(tf);
  };

  const handleTradeSuccess = (newShares: number, newAvgCost: number) => {
    setLiveHolding(
      newShares > 0 && activePortfolioId
        ? { shares: newShares, avgCost: newAvgCost, portfolioId: activePortfolioId }
        : null
    );
  };

  const displayName =
    detailData?.profile?.name ?? stockName ?? ticker;
  const currentPrice = detailData?.quote?.currentPrice ?? null;

  const changePercent = detailData?.quote?.changePercent;
  const priceIsUp =
    changePercent != null ? changePercent >= 0 : true;

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="bg-slate-950 border-slate-800 rounded-t-3xl p-0 max-h-[92dvh] overflow-hidden flex flex-col"
      >
        {/* Swipe wrapper */}
        <div
          style={{
            transform: `translateY(${dragY}px)`,
            transition: dragY === 0 ? "transform 0.3s ease" : "none",
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex flex-col h-full"
        >
          {/* Drag handle */}
          <DragHandle />

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex-1 min-w-0 pr-2">
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-white">{ticker}</span>
                {changePercent != null && (
                  <span
                    className={cn(
                      "text-xs font-semibold flex items-center gap-0.5",
                      priceIsUp ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {priceIsUp ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {changePercent >= 0 ? "+" : ""}
                    {fmtPct(changePercent)}
                  </span>
                )}
              </div>
              <p className="text-slate-400 text-sm truncate">{displayName}</p>
            </div>

            <div className="flex items-center gap-1">
              <WatchlistHeart
                status={watchlistStatus}
                isToggling={watchlistToggling}
                onToggle={toggleWatchlist}
              />
              <button
                onClick={onClose}
                className="p-2 rounded-full text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {/* Loading state for entire sheet */}
            {detailStatus === "loading" && !detailData && (
              <div className="px-4 mb-4">
                <div className="h-12 bg-slate-800/40 rounded-xl animate-pulse mb-2" />
                <div className="h-36 bg-slate-800/40 rounded-xl animate-pulse mb-2" />
                <div className="h-32 bg-slate-800/40 rounded-xl animate-pulse" />
              </div>
            )}

            {/* Error state for entire sheet */}
            {detailStatus === "error" && !detailData && (
              <div className="px-4 py-8 text-center">
                <p className="text-slate-400 mb-3">
                  {detailError ?? "Failed to load stock data"}
                </p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    fetchDetail();
                    fetchCandles(activeTimeframe);
                  }}
                  className="text-slate-300"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            )}

            {/* Main content - renders as soon as we have any data OR loading */}
            {(detailStatus === "success" || (detailData && detailStatus === "loading")) && (
              <>
                {/* Position banner */}
                {liveHolding && (
                  <PositionBanner
                    holding={liveHolding}
                    currentPrice={currentPrice}
                  />
                )}

                {/* Price chart */}
                <PriceChartSection
                  ticker={ticker}
                  quote={detailData?.quote ?? null}
                  activeTimeframe={activeTimeframe}
                  setActiveTimeframe={setActiveTimeframe}
                  candleStatus={candleStatus}
                  candleData={candleData}
                  candleError={candleError}
                  onRetry={() => fetchCandles(activeTimeframe)}
                />

                {/* Key stats */}
                {detailData && <KeyStatsSection detail={detailData} />}

                {/* News */}
                <NewsSection ticker={ticker} />

                {/* Bottom padding so content doesn't get hidden behind trade panel */}
                <div className="h-4" />
              </>
            )}
          </div>

          {/* Trade panel — sticky bottom */}
          <div className="border-t border-slate-800 bg-slate-950">
            <TradePanel
              ticker={ticker}
              context={context}
              holding={liveHolding}
              currentPrice={currentPrice}
              detailReady={detailStatus === "success"}
              portfolioId={activePortfolioId}
              onSwapIn={onSwapIn}
              onClose={onClose}
              onTradeSuccess={handleTradeSuccess}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

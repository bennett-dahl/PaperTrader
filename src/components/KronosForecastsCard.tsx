"use client";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

export interface KronosForecastRow {
  ticker: string;
  predictedReturnPct: number;
  signal: "buy" | "sell" | "hold";
}

export function deriveSignal(
  predictedReturnPct: number,
  kronosMinSignalPct: number
): "buy" | "sell" | "hold" {
  if (predictedReturnPct > kronosMinSignalPct) return "buy";
  if (predictedReturnPct < -kronosMinSignalPct) return "sell";
  return "hold";
}

interface KronosForecastsCardProps {
  forecasts: KronosForecastRow[];
  kronosMinSignalPct: number;
}

export function KronosForecastsCard({
  forecasts,
  kronosMinSignalPct,
}: KronosForecastsCardProps) {
  if (forecasts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kronos Forecasts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            No Kronos forecasts for this run.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kronos Forecasts</CardTitle>
        <CardDescription>
          24h predicted return from Kronos-base. Threshold: ±{kronosMinSignalPct}%
        </CardDescription>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 text-xs uppercase tracking-wider border-b border-slate-800">
              <th className="pb-2">Ticker</th>
              <th className="pb-2">Predicted Return</th>
              <th className="pb-2">Signal</th>
            </tr>
          </thead>
          <tbody>
            {forecasts.map((f) => (
              <tr key={f.ticker} className="border-b border-slate-800 last:border-0">
                <td className="py-2 font-mono font-semibold text-slate-200">
                  {f.ticker}
                </td>
                <td
                  className={`py-2 font-medium ${
                    f.predictedReturnPct >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {f.predictedReturnPct >= 0 ? "+" : ""}
                  {f.predictedReturnPct.toFixed(2)}%
                </td>
                <td className="py-2">
                  {f.signal === "buy" && <span>🟢 Buy</span>}
                  {f.signal === "sell" && <span>🔴 Sell</span>}
                  {f.signal === "hold" && <span>⚪ Hold</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

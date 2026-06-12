"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useId } from "react";

interface ChartDataPoint {
  time: string;
  value: number;
}

interface PriceChartProps {
  data: ChartDataPoint[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (active && payload?.length) {
    return (
      <div className="glass rounded-xl px-3 py-2 text-sm shadow-glass pointer-events-none">
        <p className="tabular font-semibold">
          ${payload[0].value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </p>
        <p className="text-slate-500 text-xs">{payload[0].payload.time}</p>
      </div>
    );
  }
  return null;
}

export default function PriceChart({ data }: PriceChartProps) {
  const gradientId = useId();
  const min = Math.min(...data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const padding = (max - min) * 0.05;
  const isUp = data[data.length - 1]?.value >= data[0]?.value;
  const color = isUp ? "var(--positive)" : "var(--negative)";

  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[min - padding, max + padding]}
          ticks={[min, max]}
          orientation="right"
          width={60}
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--glass-border)" }} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

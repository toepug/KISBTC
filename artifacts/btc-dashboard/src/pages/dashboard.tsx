import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Activity, Clock, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, Eye, EyeOff } from "lucide-react";
import {
  useGetBtcDashboard,
  useGetBtcChart,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function formatUsd(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(pct: number | null | undefined) {
  if (pct == null) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function PctBadge({ pct }: { pct: number }) {
  const isAbove = pct > 0;
  const isNeutral = Math.abs(pct) < 0.5;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-mono font-semibold px-2 py-0.5 rounded-full ${
        isNeutral
          ? "text-muted-foreground bg-muted"
          : isAbove
          ? "text-emerald-400 bg-emerald-950/60"
          : "text-red-400 bg-red-950/60"
      }`}
    >
      {isNeutral ? (
        <Minus className="w-3 h-3" />
      ) : isAbove ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
      {formatPct(pct)}
    </span>
  );
}

const TP_TOOLTIP_LABELS: Record<string, string> = {
  _sma115: "SMA × 1.15",
  _tp20: "TP1 +20%",
  _tp35: "TP2 +35%",
};

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const mainEntries = payload.filter((e: any) => !String(e.dataKey).startsWith("_"));
    const tpEntries   = payload.filter((e: any) => String(e.dataKey).startsWith("_tp"));
    return (
      <div className="bg-card border border-border p-3 rounded-md shadow-lg min-w-[210px]">
        <p className="text-xs text-muted-foreground mb-2 font-mono">
          {label ? format(new Date(label + "T00:00:00"), "MMM d, yyyy") : ""}
        </p>
        {mainEntries.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-4 text-xs font-medium py-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground">{entry.name}</span>
            </div>
            <span className="text-foreground font-mono">{formatUsd(entry.value)}</span>
          </div>
        ))}
        {tpEntries.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">
              Take Profit — this date
            </p>
            {tpEntries.map((entry: any) => (
              <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-xs font-medium py-0.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm shrink-0 opacity-80" style={{ backgroundColor: entry.color }} />
                  <span className="text-muted-foreground">
                    {TP_TOOLTIP_LABELS[entry.dataKey] ?? entry.dataKey}
                  </span>
                </div>
                <span className="font-mono" style={{ color: entry.color }}>
                  {formatUsd(entry.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return null;
}

// Zone ordering for the legend bar
const ZONE_THRESHOLDS = [
  { label: "Max Accum.", color: "#22c55e" },
  { label: "Aggressive Buy", color: "#4ade80" },
  { label: "Standard Buy (Low)", color: "#3b82f6" },
  { label: "Standard Buy (High)", color: "#eab308" },
  { label: "Take Profit", color: "#ef4444" },
];

export default function Dashboard() {
  const [now, setNow] = useState(new Date());
  const [showTpLines, setShowTpLines] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const {
    data: dashboard,
    isLoading: isDashboardLoading,
    isError: isDashboardError,
    isFetching: isDashboardFetching,
  } = useGetBtcDashboard({ query: { refetchInterval: 60000 } });

  const {
    data: chartData,
    isLoading: isChartLoading,
    isError: isChartError,
  } = useGetBtcChart({ query: { refetchInterval: 60000 } });

  if (isDashboardError || isChartError) {
    return (
      <div className="min-h-screen p-6 md:p-12 flex flex-col items-center justify-center gap-4">
        <AlertTriangle className="w-12 h-12 text-destructive" />
        <h2 className="text-2xl font-bold">Error Loading Data</h2>
        <p className="text-muted-foreground">Could not reach the data server. Please refresh to retry.</p>
      </div>
    );
  }

  const dash = dashboard as typeof dashboard & {
    triggerIndicator?: string;
    triggerDetail?: string;
    pctFromWma200w?: number;
    pctFromEma20w?: number;
    pctFromSma200d?: number;
    dailyCandlesUsed?: number;
    weeklyCandlesUsed?: number;
  };

  // Take-profit levels derived from 200D SMA — TP1 at +20%, TP2 at +35%
  const tpSma = dash?.sma200d ?? 0;
  const tp20  = tpSma * 1.20;
  const tp35  = tpSma * 1.35;
  const fmtTpLabel = (v: number) => `$${(v / 1000).toFixed(0)}k`;

  // Chart Y-axis bounds
  const chartPrices = (chartData as any)?.points?.map((p: any) => p.price).filter(Boolean) as number[] | undefined;
  const chartDataMax = chartPrices?.length ? Math.max(...chartPrices) : 0;
  const chartDataMin = chartPrices?.length ? Math.min(...chartPrices) : 0;
  const chartYMax = showTpLines && tp35 > 0
    ? Math.max(chartDataMax, tp35) * 1.06
    : chartDataMax * 1.04;
  const chartYMin = chartDataMin * 0.96;

  // Inject dynamic TP and zone boundary fields per point (computed from each point's own 200D SMA)
  const rawPoints: Record<string, unknown>[] = (chartData as any)?.points ?? [];
  const chartPoints = rawPoints.map((p) => {
    const ptSma = p.sma200d as number | null | undefined;
    return {
      ...p,
      _sma115: ptSma != null ? ptSma * 1.15 : undefined,
      _tp20: showTpLines && ptSma != null ? ptSma * 1.20 : undefined,
      _tp35: showTpLines && ptSma != null ? ptSma * 1.35 : undefined,
    };
  });

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-5">

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-border gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary shrink-0" />
            Bitcoin Strategy Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Long-term DCA strategy terminal</p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-1 text-sm">
          <div className="flex items-center gap-2 text-foreground font-mono">
            <Clock className="w-4 h-4 text-muted-foreground" />
            {format(now, "MMM d, yyyy HH:mm:ss")}
          </div>
          {dash?.lastUpdated ? (
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <RefreshCw className={`w-3 h-3 ${isDashboardFetching ? "animate-spin text-primary" : ""}`} />
              Updated {format(new Date(dash.lastUpdated), "HH:mm:ss")}
              {dash.dailyCandlesUsed && (
                <span className="ml-2 text-muted-foreground/60">
                  · {dash.dailyCandlesUsed}d / {dash.weeklyCandlesUsed}w candles
                </span>
              )}
            </div>
          ) : (
            <Skeleton className="h-4 w-48" />
          )}
        </div>
      </header>

      {/* Zone Badge */}
      <section>
        {isDashboardLoading || !dash ? (
          <Skeleton className="h-44 w-full rounded-xl" />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-xl p-6 border flex flex-col items-center justify-center text-center shadow-xl relative overflow-hidden"
            style={{
              backgroundColor: `${dash.zoneColor}12`,
              borderColor: `${dash.zoneColor}55`,
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: `radial-gradient(ellipse at center, ${dash.zoneColor}1a 0%, transparent 65%)`,
              }}
            />

            <p
              className="text-xs font-bold tracking-widest uppercase mb-2 z-10"
              style={{ color: `${dash.zoneColor}cc` }}
            >
              Current Market Zone
            </p>

            <div
              className="text-4xl md:text-5xl font-black mb-3 z-10 tracking-tight"
              style={{ color: dash.zoneColor }}
            >
              {dash.zoneLabel}
            </div>

            {dash.triggerDetail && (
              <p className="text-xs font-mono text-muted-foreground mb-3 z-10 bg-background/40 px-3 py-1 rounded-full border border-border/40">
                Triggered by: {dash.triggerDetail}
              </p>
            )}

            <div className="bg-background/70 backdrop-blur-sm border border-border/60 px-5 py-3 rounded-full z-10">
              <p className="text-base font-medium text-foreground">{dash.actionText}</p>
            </div>
          </motion.div>
        )}
      </section>

      {/* Zone Strategy Guide */}
      <section>
        <div className="flex items-center gap-1 rounded-lg border border-border overflow-hidden">
          {ZONE_THRESHOLDS.map((z) => (
            <div
              key={z.label}
              className="flex-1 py-2 text-center text-[10px] font-semibold tracking-wide"
              style={{
                backgroundColor:
                  dash?.zoneColor === z.color ? `${z.color}25` : "transparent",
                color: dash?.zoneColor === z.color ? z.color : "hsl(var(--muted-foreground))",
                borderBottom:
                  dash?.zoneColor === z.color ? `2px solid ${z.color}` : "2px solid transparent",
              }}
            >
              {z.label}
            </div>
          ))}
        </div>
      </section>

      {/* Indicator Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isDashboardLoading || !dash ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))
        ) : (
          <>
            {/* BTC Price */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <Card className="bg-card border-border h-full">
                <CardHeader className="p-4 pb-1">
                  <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">
                    BTC Price
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1">
                  <div className="text-xl md:text-2xl font-mono font-bold text-foreground">
                    {formatUsd(dash.currentPrice)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Live (Kraken)</p>
                </CardContent>
              </Card>
            </motion.div>

            {/* 200W WMA */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="h-full relative overflow-hidden">
                <CardHeader className="p-4 pb-1">
                  <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">
                    200W WMA — Floor
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1">
                  <div className="text-xl md:text-2xl font-mono font-bold" style={{ color: "#ef4444" }}>
                    {formatUsd(dash.wma200w)}
                  </div>
                  {dash.pctFromWma200w != null && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Distance to Floor
                      </p>
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className="text-2xl font-black font-mono tabular-nums"
                          style={{ color: dash.pctFromWma200w < 5 ? "#ef4444" : dash.pctFromWma200w < 15 ? "#eab308" : "#22c55e" }}
                        >
                          +{dash.pctFromWma200w.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* 20W EMA */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <Card className="bg-card border-border h-full">
                <CardHeader className="p-4 pb-1">
                  <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">
                    20W EMA
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1">
                  <div className="text-xl md:text-2xl font-mono font-bold" style={{ color: "#3b82f6" }}>
                    {formatUsd(dash.ema20w)}
                  </div>
                  {dash.pctFromEma20w != null && (
                    <div className="mt-1">
                      <PctBadge pct={dash.pctFromEma20w} />
                      <span className="text-xs text-muted-foreground ml-1">vs price</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* 200D SMA */}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="bg-card border-border h-full">
                <CardHeader className="p-4 pb-1">
                  <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-widest">
                    200D SMA
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-1">
                  <div className="text-xl md:text-2xl font-mono font-bold" style={{ color: "#eab308" }}>
                    {formatUsd(dash.sma200d)}
                  </div>
                  {dash.pctFromSma200d != null && (
                    <div className="mt-1">
                      <PctBadge pct={dash.pctFromSma200d} />
                      <span className="text-xs text-muted-foreground ml-1">vs price</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </section>

      {/* Zone Logic Explainer */}
      {dash && !isDashboardLoading && (
        <section>
          <Card className="bg-card border-border">
            <CardHeader className="p-4 pb-2 border-b border-border">
              <CardTitle className="text-sm text-muted-foreground font-semibold uppercase tracking-widest">
                Zone Logic — How This Zone Was Determined
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className={`rounded-lg p-3 border ${dash.zone === "MAX_ACCUMULATION" ? "border-green-500/50 bg-green-950/20" : "border-border bg-muted/20"}`}>
                  <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Step 1</div>
                  <div className="font-mono text-xs mb-1">Price ≤ 200W WMA?</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${(dash.currentPrice <= dash.wma200w!) ? "text-green-400" : "text-red-400"}`}>
                      {(dash.currentPrice <= dash.wma200w!) ? "YES → Max Accumulation" : "NO"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {formatUsd(dash.currentPrice)} vs {formatUsd(dash.wma200w)}
                  </div>
                </div>

                <div className={`rounded-lg p-3 border ${dash.zone === "AGGRESSIVE_BUY" ? "border-green-400/50 bg-green-950/20" : "border-border bg-muted/20"}`}>
                  <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Step 2</div>
                  <div className="font-mono text-xs mb-1">Price ≤ 20W EMA?</div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${(dash.currentPrice <= dash.ema20w!) ? "text-green-400" : "text-red-400"}`}>
                      {(dash.currentPrice <= dash.ema20w!) ? "YES → Aggressive Buy" : "NO"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {formatUsd(dash.currentPrice)} vs {formatUsd(dash.ema20w)}
                  </div>
                </div>

                <div className={`rounded-lg p-3 border ${["STANDARD_BUY_LOW","STANDARD_BUY_HIGH","TAKE_PROFIT"].includes(dash.zone!) ? "border-yellow-500/50 bg-yellow-950/10" : "border-border bg-muted/20"}`}>
                  <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Step 3</div>
                  <div className="font-mono text-xs mb-1">% above 200D SMA?</div>
                  <div className="text-xs font-bold text-muted-foreground">
                    {dash.pctFromSma200d != null && (
                      <span className={
                        dash.pctFromSma200d <= 0 ? "text-blue-400"
                        : dash.pctFromSma200d < 20 ? "text-yellow-400"
                        : "text-red-400"
                      }>
                        {formatPct(dash.pctFromSma200d)} from SMA
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    ≤0%: Std Low &nbsp;·&nbsp; ≤+15%: Std High &nbsp;·&nbsp; ≥+20%: TP1 &nbsp;·&nbsp; ≥+35%: TP2
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Chart */}
      <section>
        <Card className="bg-card border-border">
          <CardHeader className="p-4 border-b border-border flex flex-row items-center gap-2">
            <Activity className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">Price vs Moving Averages (2-Year Daily)</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                BTC price with 200W WMA · 20W EMA · 200D SMA · Take Profit levels
              </p>
            </div>
            <button
              onClick={() => setShowTpLines((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors shrink-0 ${
                showTpLines
                  ? "border-orange-500/50 bg-orange-950/30 text-orange-400 hover:bg-orange-950/50"
                  : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {showTpLines ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              TP Lines
            </button>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            {isChartLoading || !chartData ? (
              <Skeleton className="h-[420px] w-full rounded-xl" />
            ) : (
              <div className="h-[420px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartPoints}
                    margin={{ top: 10, right: 8, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => {
                        try { return format(new Date(val + "T00:00:00"), "MMM yy"); } catch { return val; }
                      }}
                      minTickGap={60}
                    />
                    <YAxis
                      yAxisId="price"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                      domain={[chartYMin, chartYMax]}
                      width={48}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ paddingTop: "16px", fontSize: "12px" }}
                      formatter={(value: string) => value.startsWith("_") ? null : value}
                      payload={[
                        { value: "BTC Price",  type: "circle", id: "price",   color: "hsl(var(--foreground))" },
                        { value: "200W WMA",   type: "circle", id: "wma200w", color: "#22c55e" },
                        { value: "20W EMA",    type: "circle", id: "ema20w",  color: "#4ade80" },
                        { value: "200D SMA",   type: "circle", id: "sma200d", color: "#3b82f6" },
                        { value: "SMA × 1.15", type: "circle", id: "_sma115", color: "#eab308" },
                      ]}
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="price"
                      name="BTC Price"
                      stroke="hsl(var(--foreground))"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="wma200w"
                      name="200W WMA"
                      stroke="#22c55e"
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="ema20w"
                      name="20W EMA"
                      stroke="#4ade80"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="sma200d"
                      name="200D SMA"
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                    {dash?.currentPrice && (
                      <ReferenceLine
                        yAxisId="price"
                        y={dash.currentPrice}
                        stroke="hsl(var(--foreground))"
                        strokeDasharray="2 4"
                        strokeOpacity={0.4}
                        label={{ value: "Now", position: "right", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      />
                    )}
                    {/* Current Take Profit target reference lines */}
                    {showTpLines && tpSma > 0 && (
                      <>
                        <ReferenceLine
                          yAxisId="price"
                          y={tp20}
                          stroke="#f97316"
                          strokeOpacity={0.45}
                          strokeDasharray="2 6"
                          label={{ value: `TP1 +20% ${fmtTpLabel(tp20)}`, position: "insideTopRight", fontSize: 9, fill: "#f97316" }}
                        />
                        <ReferenceLine
                          yAxisId="price"
                          y={tp35}
                          stroke="#ef4444"
                          strokeOpacity={0.45}
                          strokeDasharray="2 6"
                          label={{ value: `TP2 +35% ${fmtTpLabel(tp35)}`, position: "insideTopRight", fontSize: 9, fill: "#ef4444" }}
                        />
                      </>
                    )}
                    {/* SMA × 1.15 — upper boundary of Standard Buy High zone */}
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="_sma115"
                      name="SMA × 1.15"
                      stroke="#eab308"
                      strokeWidth={1.5}
                      strokeDasharray="5 3"
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                    {/* Dynamic TP lines curved with historical SMA */}
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="_tp20"
                      stroke="#f97316"
                      strokeWidth={1.5}
                      strokeDasharray="8 4"
                      dot={false}
                      legendType="none"
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="_tp35"
                      stroke="#ef4444"
                      strokeWidth={1.5}
                      strokeDasharray="8 4"
                      dot={false}
                      legendType="none"
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {showTpLines && tpSma > 0 && (
              <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-6 border-t-2 border-dashed border-[#f97316]" />
                  <span className="text-xs font-semibold text-[#f97316]">TP1 +20%</span>
                  <span className="text-xs text-muted-foreground font-mono">{fmtTpLabel(tp20)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-6 border-t-2 border-dashed border-[#ef4444]" />
                  <span className="text-xs font-semibold text-[#ef4444]">TP2 +35%</span>
                  <span className="text-xs text-muted-foreground font-mono">{fmtTpLabel(tp35)}</span>
                </div>
                <span className="text-xs text-muted-foreground ml-auto self-center">Current Targets · hover chart for historical levels</span>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

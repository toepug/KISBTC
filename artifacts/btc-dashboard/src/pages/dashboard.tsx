import { useEffect, useState } from "react";
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
import { Activity, Clock, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, Minus, Eye, EyeOff, Flame, ShieldCheck, ShieldAlert } from "lucide-react";
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
  _tp50: "TP1 +50%",
  _tp80: "TP2 +80%",
  _tp100: "TP3 +100%",
};

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const mainEntries = payload.filter((e: any) => !String(e.dataKey).startsWith("_tp"));
    const tpEntries = payload.filter((e: any) => String(e.dataKey).startsWith("_tp"));
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

  // Cast to include the extra fields we added
  const dash = dashboard as typeof dashboard & {
    triggerIndicator?: string;
    triggerDetail?: string;
    pctFromWma200w?: number;
    pctFromEma20w?: number;
    pctFromSma200d?: number;
    dailyCandlesUsed?: number;
    weeklyCandlesUsed?: number;
  };

  // Take-profit levels derived from 200D SMA
  const tpSma = dash?.sma200d ?? 0;
  const tp50  = tpSma * 1.50;
  const tp80  = tpSma * 1.80;
  const tp100 = tpSma * 2.00;
  const fmtTpLabel = (v: number) => `$${(v / 1000).toFixed(0)}k`;

  // Chart Y-axis bounds + augmented points with TP constants injected
  const chartPrices = (chartData as any)?.points?.map((p: any) => p.price).filter(Boolean) as number[] | undefined;
  const chartDataMax = chartPrices?.length ? Math.max(...chartPrices) : 0;
  const chartDataMin = chartPrices?.length ? Math.min(...chartPrices) : 0;
  const chartYMax = showTpLines && tp100 > 0
    ? Math.max(chartDataMax, tp100) * 1.04
    : chartDataMax * 1.04;
  const chartYMin = chartDataMin * 0.96;

  // Inject dynamic TP fields per chart point, computed from each point's own 200D SMA.
  // This makes TP lines curve with historical SMA rather than being flat constants.
  // Always inject (undefined when hidden) so Recharts never deals with dynamic Line children.
  const rawPoints: Record<string, unknown>[] = (chartData as any)?.points ?? [];
  const chartPoints = rawPoints.map((p) => {
    const ptSma = p.sma200d as number | null | undefined;
    return {
      ...p,
      _tp50:  showTpLines && ptSma != null ? ptSma * 1.5 : undefined,
      _tp80:  showTpLines && ptSma != null ? ptSma * 1.8 : undefined,
      _tp100: showTpLines && ptSma != null ? ptSma * 2.0 : undefined,
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
            {/* Glow */}
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

            {/* Trigger reason */}
            {dash.triggerDetail && (
              <p className="text-xs font-mono text-muted-foreground mb-3 z-10 bg-background/40 px-3 py-1 rounded-full border border-border/40">
                Triggered by: {dash.triggerDetail}
              </p>
            )}

            <div className="bg-background/70 backdrop-blur-sm border border-border/60 px-5 py-3 rounded-full z-10">
              <p className="text-base font-medium text-foreground">{dash.actionText}</p>
            </div>

            {(dash as any).safetyOverride && (
              <div className="mt-4 z-10 flex items-start gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 text-xs max-w-lg text-left">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                <span>
                  <span className="font-semibold text-amber-400">Safety override active — </span>
                  price is &gt;25% above the 200D SMA. Aggressive accumulation is suspended. Contribution defaulted to Standard Buy (High) rate.
                </span>
              </div>
            )}
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
                      <span className={dash.pctFromSma200d < 0 ? "text-blue-400" : dash.pctFromSma200d < 25 ? "text-blue-400" : dash.pctFromSma200d < 50 ? "text-yellow-400" : "text-red-400"}>
                        {formatPct(dash.pctFromSma200d)} from SMA
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    &lt;0%: Standard Buy Low &nbsp;·&nbsp; 25–50%: High &nbsp;·&nbsp; ≥50%: Take Profit
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Heat Index */}
      {dash && (
        <section>
          <Card className={`border ${dash.heatSignals?.anyTriggered ? "border-red-500/50 bg-red-950/10" : "bg-card border-border"}`}>
            <CardHeader className="p-4 border-b border-border flex flex-row items-center gap-2">
              <Flame className={`w-5 h-5 shrink-0 ${dash.heatSignals?.anyTriggered ? "text-red-400" : "text-muted-foreground"}`} />
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  Heat Index
                  {dash.heatSignals?.anyTriggered ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                      SELL SIGNAL ACTIVE
                    </span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border">
                      ALL CLEAR
                    </span>
                  )}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Extended sell signals independent of price or SMA levels
                </p>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

                {/* RSI Signal */}
                {(() => {
                  const sig = dash.heatSignals?.rsi;
                  const active = sig?.active ?? false;
                  return (
                    <div className={`rounded-lg p-3 border ${active ? "border-red-500/50 bg-red-950/20" : "border-border bg-muted/20"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                          Weekly RSI Cap
                        </div>
                        <div className={`flex items-center gap-1 text-xs font-bold ${active ? "text-red-400" : "text-emerald-400"}`}>
                          {active ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          {active ? "TRIGGERED" : "CLEAR"}
                        </div>
                      </div>
                      <div className={`text-2xl font-mono font-bold mb-1 ${active ? "text-red-400" : "text-foreground"}`}>
                        {sig?.value != null ? sig.value.toFixed(1) : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">Weekly RSI-14 · threshold 80</div>
                      <div className={`w-full h-1.5 rounded-full bg-muted overflow-hidden`}>
                        <div
                          className={`h-full rounded-full transition-all ${(sig?.value ?? 0) > 80 ? "bg-red-500" : (sig?.value ?? 0) > 65 ? "bg-yellow-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, ((sig?.value ?? 0) / 100) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
                        <span>0</span><span className="text-yellow-500/70">65</span><span className="text-red-500/70">80</span><span>100</span>
                      </div>
                      <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">{sig?.description}</p>
                    </div>
                  );
                })()}

                {/* SMA Parabolic Signal */}
                {(() => {
                  const sig = dash.heatSignals?.smaParabolic;
                  const active = sig?.active ?? false;
                  const acc = sig?.acceleration ?? 0;
                  return (
                    <div className={`rounded-lg p-3 border ${active ? "border-red-500/50 bg-red-950/20" : "border-border bg-muted/20"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                          SMA Deceleration
                        </div>
                        <div className={`flex items-center gap-1 text-xs font-bold ${active ? "text-red-400" : "text-emerald-400"}`}>
                          {active ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          {active ? "TRIGGERED" : "CLEAR"}
                        </div>
                      </div>
                      <div className={`text-2xl font-mono font-bold mb-1 ${active ? "text-red-400" : acc > 0 ? "text-yellow-400" : "text-foreground"}`}>
                        {acc > 0 ? "+" : ""}{acc != null ? `$${Math.abs(acc).toFixed(0)}` : "—"}<span className="text-sm font-normal text-muted-foreground">/20d</span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">200D SMA acceleration · triggers at &gt;30% above SMA</div>
                      <div className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">{sig?.description}</div>
                    </div>
                  );
                })()}

                {/* Trailing Stop Signal */}
                {(() => {
                  const sig = dash.heatSignals?.trailingStop;
                  const triggered = sig?.triggered ?? false;
                  const armed = sig?.armed ?? false;
                  const drawdown = sig?.drawdownPct ?? 0;
                  return (
                    <div className={`rounded-lg p-3 border ${triggered ? "border-red-500/50 bg-red-950/20" : armed ? "border-yellow-500/40 bg-yellow-950/10" : "border-border bg-muted/20"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                          Trailing TP
                        </div>
                        <div className={`flex items-center gap-1 text-xs font-bold ${triggered ? "text-red-400" : armed ? "text-yellow-400" : "text-emerald-400"}`}>
                          {triggered ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                          {triggered ? "TRIGGERED" : armed ? "ARMED" : "INACTIVE"}
                        </div>
                      </div>
                      <div className={`text-2xl font-mono font-bold mb-1 ${triggered ? "text-red-400" : armed ? "text-yellow-400" : "text-muted-foreground"}`}>
                        {armed ? `${drawdown.toFixed(1)}%` : "—"}
                        <span className="text-sm font-normal text-muted-foreground ml-1">
                          {armed ? "from peak" : ""}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mb-2">
                        Arms &gt;40% above SMA · triggers at −10% drawdown from 20d peak
                      </div>
                      {armed && sig?.localPeak && (
                        <div className="text-xs text-muted-foreground/80 mb-1 font-mono">
                          20d peak: {formatUsd(sig.localPeak)}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground/80 leading-relaxed">{sig?.description}</p>
                    </div>
                  );
                })()}

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
                        { value: "200W WMA",   type: "circle", id: "wma200w", color: "#ef4444" },
                        { value: "20W EMA",    type: "circle", id: "ema20w",  color: "#3b82f6" },
                        { value: "200D SMA",   type: "circle", id: "sma200d", color: "#eab308" },
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
                      stroke="#ef4444"
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
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="sma200d"
                      name="200D SMA"
                      stroke="#eab308"
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
                    {/* Current Target reference lines — today's TP levels as flat horizontal markers */}
                    {showTpLines && tpSma > 0 && (
                      <>
                        <ReferenceLine
                          yAxisId="price"
                          y={tp50}
                          stroke="#f97316"
                          strokeOpacity={0.45}
                          strokeDasharray="2 6"
                          label={{ value: `TP1 Target ${fmtTpLabel(tp50)}`, position: "insideTopRight", fontSize: 9, fill: "#f97316" }}
                        />
                        <ReferenceLine
                          yAxisId="price"
                          y={tp80}
                          stroke="#ef4444"
                          strokeOpacity={0.45}
                          strokeDasharray="2 6"
                          label={{ value: `TP2 Target ${fmtTpLabel(tp80)}`, position: "insideTopRight", fontSize: 9, fill: "#ef4444" }}
                        />
                        <ReferenceLine
                          yAxisId="price"
                          y={tp100}
                          stroke="#dc2626"
                          strokeOpacity={0.45}
                          strokeDasharray="2 6"
                          label={{ value: `TP3 Target ${fmtTpLabel(tp100)}`, position: "insideTopRight", fontSize: 9, fill: "#dc2626" }}
                        />
                      </>
                    )}
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="_tp50"
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
                      dataKey="_tp80"
                      stroke="#ef4444"
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
                      dataKey="_tp100"
                      stroke="#dc2626"
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
                  <span className="text-xs font-semibold text-[#f97316]">TP1 +50%</span>
                  <span className="text-xs text-muted-foreground font-mono">{fmtTpLabel(tp50)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-6 border-t-2 border-dashed border-[#ef4444]" />
                  <span className="text-xs font-semibold text-[#ef4444]">TP2 +80%</span>
                  <span className="text-xs text-muted-foreground font-mono">{fmtTpLabel(tp80)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-6 border-t-2 border-dashed border-[#dc2626]" />
                  <span className="text-xs font-semibold text-[#dc2626]">TP3 +100%</span>
                  <span className="text-xs text-muted-foreground font-mono">{fmtTpLabel(tp100)}</span>
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

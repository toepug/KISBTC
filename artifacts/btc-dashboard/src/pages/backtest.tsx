import { useState, useMemo } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { useGetBtcBacktest } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";

const ZONE_COLORS: Record<string, string> = {
  MAX_ACCUMULATION: "#22c55e",
  AGGRESSIVE_BUY: "#4ade80",
  STANDARD_BUY_LOW: "#3b82f6",
  STANDARD_BUY_HIGH: "#eab308",
  TAKE_PROFIT: "#ef4444",
};

const ZONE_LABELS: Record<string, string> = {
  MAX_ACCUMULATION: "Max Accum",
  AGGRESSIVE_BUY: "Aggressive Buy",
  STANDARD_BUY_LOW: "Standard Low",
  STANDARD_BUY_HIGH: "Standard High",
  TAKE_PROFIT: "Take Profit",
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPct(n: number) {
  return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
}
function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function defaultStartDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().split("T")[0];
}

interface RunParams {
  startDate: string;
  baseInstallment: number;
  startingCash: number;
}

export default function Backtest() {
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [baseInstallment, setBaseInstallment] = useState(500);
  const [startingCash, setStartingCash] = useState(0);
  const [runParams, setRunParams] = useState<RunParams | null>(null);
  const [tradeLogOpen, setTradeLogOpen] = useState(false);

  const { data, isLoading, isError, error } = useGetBtcBacktest(
    runParams ?? { startDate: "", baseInstallment: 500, startingCash: 0 },
    { query: { enabled: !!runParams, staleTime: Infinity } }
  );

  function handleRun() {
    setRunParams({ startDate, baseInstallment, startingCash });
  }

  const zoneRuns = useMemo(() => {
    if (!data?.history?.length) return [];
    const runs: Array<{ zone: string; start: string; end: string }> = [];
    let curZone = data.history[0].zone;
    let runStart = data.history[0].date;
    for (const pt of data.history) {
      if (pt.zone !== curZone) {
        runs.push({ zone: curZone, start: runStart, end: pt.date });
        curZone = pt.zone;
        runStart = pt.date;
      }
    }
    if (data.history.length > 0) {
      runs.push({ zone: curZone, start: runStart, end: data.history.at(-1)!.date });
    }
    return runs;
  }, [data?.history]);

  const chartData = useMemo(() => {
    if (!data?.history) return [];
    return data.history.filter((_, i) => i % 3 === 0 || i === data.history.length - 1);
  }, [data?.history]);

  const s = data?.summary;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Backtest Calculator</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simulate the Questrade V3.1 zone-based DCA strategy against real historical BTC prices.
        </p>
      </div>

      {/* Controls */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Simulation Parameters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-background border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Base Installment (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min={1}
                  value={baseInstallment}
                  onChange={(e) => setBaseInstallment(Math.max(1, parseFloat(e.target.value) || 1))}
                  className="bg-background border border-border rounded-md pl-7 pr-3 py-2 text-sm text-foreground w-36 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Starting Cash (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <input
                  type="number"
                  min={0}
                  value={startingCash}
                  onChange={(e) => setStartingCash(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="bg-background border border-border rounded-md pl-7 pr-3 py-2 text-sm text-foreground w-36 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground invisible">Run</label>
              <Button
                onClick={handleRun}
                disabled={isLoading}
                className="bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
              >
                {isLoading ? (
                  <span className="animate-spin h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {isLoading ? "Running…" : "Run Backtest"}
              </Button>
            </div>
          </div>

          {/* Zone preview */}
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { zone: "MAX_ACCUMULATION", mult: 2.0 },
              { zone: "AGGRESSIVE_BUY", mult: 1.5 },
              { zone: "STANDARD_BUY_LOW", mult: 1.0 },
              { zone: "STANDARD_BUY_HIGH", mult: 0.6 },
              { zone: "TAKE_PROFIT", mult: 0.0 },
            ].map(({ zone, mult }) => (
              <div key={zone} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: ZONE_COLORS[zone] }}
                />
                <span>{ZONE_LABELS[zone]}:</span>
                <span className="text-foreground font-medium">
                  {fmt(baseInstallment * mult)}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {isError && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-4 flex items-center gap-2 text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="text-sm">{(error as { message?: string })?.message ?? "Backtest failed. Please try again."}</span>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!runParams && !data && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BarChart3 className="w-14 h-14 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground text-sm">Set your parameters above and click <strong>Run Backtest</strong> to see results.</p>
        </div>
      )}

      {/* Results */}
      {data && s && (
        <div className="space-y-5">
          {/* Date range badge */}
          <p className="text-xs text-muted-foreground">
            Simulation: <span className="text-foreground">{fmtDate(data.startDate)}</span>
            {" → "}
            <span className="text-foreground">{fmtDate(data.endDate)}</span>
            {" · "}
            {s.numContributions} contributions · {s.numSells} TP sells
          </p>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="Final Portfolio"
              value={fmt(s.finalValue)}
              sub={`${fmtPct(s.returnPct)} return`}
              positive={s.returnPct >= 0}
              icon={<DollarSign className="w-4 h-4" />}
              accent
            />
            <SummaryCard
              label="vs Simple DCA"
              value={fmt(Math.abs(s.outperformance))}
              sub={s.outperformance >= 0 ? "outperforms DCA" : "underperforms DCA"}
              positive={s.outperformance >= 0}
              icon={s.outperformance >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
            />
            <SummaryCard
              label="Total Invested"
              value={fmt(s.totalInvested)}
              sub={`Net profit: ${fmt(s.netProfit)}`}
              positive={s.netProfit >= 0}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <SummaryCard
              label="Max Drawdown"
              value={fmtPct(s.maxDrawdown)}
              sub={`${fmt(s.btcValue)} BTC · ${fmt(s.cashBalance)} cash`}
              positive={false}
              icon={<TrendingDown className="w-4 h-4" />}
            />
          </div>

          {/* Portfolio chart */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Portfolio Growth
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  {zoneRuns.map((run, i) => (
                    <ReferenceArea
                      key={i}
                      x1={run.start}
                      x2={run.end}
                      fill={ZONE_COLORS[run.zone] + "18"}
                      fillOpacity={1}
                      stroke="none"
                    />
                  ))}
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(d: string) =>
                      new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" })
                    }
                    interval="preserveStartEnd"
                    minTickGap={60}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K` : `$${v}`
                    }
                    width={64}
                  />
                  <Tooltip
                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(d: string) => fmtDate(d)}
                    formatter={(value: number, name: string) => [
                      fmt(value),
                      name === "portfolioValue" ? "KISBTC" : "Simple DCA",
                    ]}
                  />
                  <Legend
                    iconType="plainline"
                    formatter={(value: string) => value === "portfolioValue" ? "KISBTC Strategy" : "Simple DCA"}
                    wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 8 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="portfolioValue"
                    stroke="#f97316"
                    strokeWidth={2}
                    fill="#f9731620"
                    dot={false}
                    activeDot={{ r: 4, fill: "#f97316" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="dcaValue"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    dot={false}
                    activeDot={{ r: 3, fill: "#94a3b8" }}
                  />
                </ComposedChart>
              </ResponsiveContainer>

              {/* Zone legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                {Object.entries(ZONE_LABELS).map(([zone, label]) => (
                  <span key={zone} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm opacity-60" style={{ background: ZONE_COLORS[zone] }} />
                    {label}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Comparison + Zone stats */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Comparison table */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Strategy Comparison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs border-b border-border">
                      <th className="text-left py-1.5 font-medium">Metric</th>
                      <th className="text-right py-1.5 font-medium text-orange-400">KISBTC</th>
                      <th className="text-right py-1.5 font-medium text-slate-400">Simple DCA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    <CompRow label="Final Value" a={fmt(s.finalValue)} b={fmt(s.dcaFinalValue)} better={s.finalValue >= s.dcaFinalValue} />
                    <CompRow label="Total Invested" a={fmt(s.totalInvested)} b={fmt(s.dcaTotalInvested)} better={s.totalInvested <= s.dcaTotalInvested} />
                    <CompRow label="Net Profit" a={fmt(s.netProfit)} b={fmt(s.dcaFinalValue - s.dcaTotalInvested)} better={s.netProfit >= s.dcaFinalValue - s.dcaTotalInvested} />
                    <CompRow label="Return %" a={fmtPct(s.returnPct)} b={fmtPct(s.dcaTotalInvested > 0 ? ((s.dcaFinalValue - s.dcaTotalInvested) / s.dcaTotalInvested) * 100 : 0)} better={s.returnPct >= 0} />
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Zone stats */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Capital by Zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                {data.zoneStats
                  .sort((a, b) => b.totalDeployed - a.totalDeployed)
                  .map((z) => (
                    <div key={z.zone}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: z.color }} />
                          <span className="text-muted-foreground">{z.label}</span>
                        </span>
                        <span className="text-foreground font-medium">
                          {fmt(z.totalDeployed)} <span className="text-muted-foreground font-normal">({z.count}×)</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(z.totalDeployed / s.totalInvested) * 100}%`,
                            background: z.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                {data.zoneStats.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-4">No buy contributions in this period.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Trade log */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2">
              <button
                className="flex items-center justify-between w-full"
                onClick={() => setTradeLogOpen((o) => !o)}
              >
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Trade Log <span className="text-xs font-normal normal-case text-muted-foreground/60">({data.trades.length} events)</span>
                </CardTitle>
                {tradeLogOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
            </CardHeader>
            {tradeLogOpen && (
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted-foreground border-b border-border">
                        <th className="text-left py-1.5 font-medium">Date</th>
                        <th className="text-left py-1.5 font-medium">Type</th>
                        <th className="text-left py-1.5 font-medium">Zone / Label</th>
                        <th className="text-right py-1.5 font-medium">BTC Price</th>
                        <th className="text-right py-1.5 font-medium">Amount</th>
                        <th className="text-right py-1.5 font-medium">BTC Δ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {data.trades.map((t, i) => (
                        <tr key={i} className="hover:bg-muted/30 transition-colors">
                          <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">{fmtDate(t.date)}</td>
                          <td className="py-1.5 pr-4">
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0"
                              style={{
                                borderColor: t.type === "BUY" ? "#22c55e" : "#ef4444",
                                color: t.type === "BUY" ? "#22c55e" : "#ef4444",
                              }}
                            >
                              {t.type}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-4 text-muted-foreground">{t.label}</td>
                          <td className="py-1.5 pr-4 text-right">{fmt(t.price)}</td>
                          <td className="py-1.5 pr-4 text-right">{fmt(t.amount)}</td>
                          <td
                            className="py-1.5 text-right"
                            style={{ color: t.btcDelta >= 0 ? "#22c55e" : "#ef4444" }}
                          >
                            {t.btcDelta >= 0 ? "+" : ""}{t.btcDelta.toFixed(6)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label, value, sub, positive, icon, accent = false,
}: {
  label: string; value: string; sub: string; positive: boolean; icon: React.ReactNode; accent?: boolean;
}) {
  return (
    <Card className={`border-border bg-card ${accent ? "ring-1 ring-primary/30" : ""}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={`${accent ? "text-primary" : positive ? "text-green-400" : "text-muted-foreground"}`}>{icon}</span>
        </div>
        <div className="text-xl font-bold text-foreground leading-tight">{value}</div>
        <div className={`text-xs mt-0.5 ${positive ? "text-green-400" : "text-muted-foreground"}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}

function CompRow({ label, a, b, better }: { label: string; a: string; b: string; better: boolean }) {
  return (
    <tr>
      <td className="py-2 text-muted-foreground">{label}</td>
      <td className={`py-2 text-right font-medium ${better ? "text-orange-400" : "text-foreground"}`}>{a}</td>
      <td className="py-2 text-right text-slate-400">{b}</td>
    </tr>
  );
}

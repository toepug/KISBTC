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
} from "recharts";
import { Activity, Clock, RefreshCw, AlertTriangle } from "lucide-react";
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

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card border border-border p-3 rounded-md shadow-lg">
        <p className="text-sm text-muted-foreground mb-2">{format(new Date(label), "MMM d, yyyy")}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm font-medium">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-foreground">{entry.name}:</span>
            <span className="text-foreground">{formatUsd(entry.value)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export default function Dashboard() {
  const [now, setNow] = useState(new Date());

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
  } = useGetBtcChart();

  if (isDashboardError || isChartError) {
    return (
      <div className="min-h-screen p-6 md:p-12 flex flex-col items-center justify-center">
        <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Error Loading Data</h2>
        <p className="text-muted-foreground">Please check your connection and try again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-border gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            Bitcoin Strategy Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Terminal view for long-term holders</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <div className="flex items-center gap-2 text-foreground font-mono">
            <Clock className="w-4 h-4" />
            {format(now, "MMM d, yyyy HH:mm:ss")}
          </div>
          {dashboard?.lastUpdated ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RefreshCw className={`w-3 h-3 ${isDashboardFetching ? 'animate-spin text-primary' : ''}`} />
              Last updated: {format(new Date(dashboard.lastUpdated), "HH:mm:ss")}
            </div>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
        </div>
      </header>

      {/* Zone Status Badge */}
      <section>
        {isDashboardLoading || !dashboard ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl p-6 border flex flex-col items-center justify-center text-center shadow-lg relative overflow-hidden"
            style={{
              backgroundColor: `${dashboard.zoneColor}15`,
              borderColor: dashboard.zoneColor,
            }}
          >
            <div 
              className="absolute inset-0 opacity-20 pointer-events-none"
              style={{
                background: `radial-gradient(circle at center, ${dashboard.zoneColor} 0%, transparent 70%)`
              }}
            />
            <h2 
              className="text-sm font-semibold tracking-widest uppercase mb-2 z-10"
              style={{ color: dashboard.zoneColor }}
            >
              Current Market Zone
            </h2>
            <div 
              className="text-4xl md:text-5xl font-black mb-4 z-10 tracking-tight"
              style={{ color: dashboard.zoneColor }}
            >
              {dashboard.zoneLabel}
            </div>
            <div className="bg-background/80 backdrop-blur-sm border border-border px-6 py-3 rounded-full z-10">
              <p className="text-lg font-medium text-foreground">
                {dashboard.actionText}
              </p>
            </div>
          </motion.div>
        )}
      </section>

      {/* Indicator Table */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {isDashboardLoading || !dashboard ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))
        ) : (
          <>
            <Card className="bg-card">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wider">
                  BTC Price
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatUsd(dashboard.currentPrice)}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wider">
                  200W WMA
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatUsd(dashboard.wma200w)}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wider">
                  20W EMA
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatUsd(dashboard.ema20w)}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium uppercase tracking-wider">
                  200D SMA
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="text-2xl font-mono font-bold text-foreground">
                  {formatUsd(dashboard.sma200d)}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {/* Chart Section */}
      <section>
        <Card className="bg-card border-border">
          <CardHeader className="border-b border-border flex flex-row items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Price vs Moving Averages</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {isChartLoading || !chartData ? (
              <Skeleton className="h-[400px] w-full rounded-xl" />
            ) : (
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData.points} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => format(new Date(val), "MMM yyyy")}
                      minTickGap={50}
                    />
                    <YAxis 
                      yAxisId="price"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                    <Line 
                      yAxisId="price"
                      type="monotone" 
                      dataKey="price" 
                      name="BTC Price"
                      stroke="hsl(var(--foreground))" 
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line 
                      yAxisId="price"
                      type="monotone" 
                      dataKey="wma200w" 
                      name="200W WMA"
                      stroke="#ef4444" 
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Line 
                      yAxisId="price"
                      type="monotone" 
                      dataKey="ema20w" 
                      name="20W EMA"
                      stroke="#3b82f6" 
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Line 
                      yAxisId="price"
                      type="monotone" 
                      dataKey="sma200d" 
                      name="200D SMA"
                      stroke="#eab308" 
                      strokeWidth={1.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  Banknote,
  Info,
} from "lucide-react";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, delay },
});

function SectionHeading({ icon: Icon, title, color = "text-primary" }: { icon: any; title: string; color?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${color}`}>
      <Icon className="w-5 h-5 shrink-0" />
      <h2 className="text-lg font-bold">{title}</h2>
    </div>
  );
}

const ACCUMULATION_ROWS = [
  {
    zone: "Max Accumulation",
    condition: "Price ≤ 200W WMA",
    action: "Contribute $1,000",
    color: "#22c55e",
    note: "Rare historic floor — deploy maximum capital",
  },
  {
    zone: "Aggressive Buy",
    condition: "Price ≤ 20W EMA",
    action: "Contribute $750",
    color: "#4ade80",
    note: "Below the 20-week trend — strong buy signal",
  },
  {
    zone: "Standard Buy (Low)",
    condition: "Price > 20W EMA and ≤ 25% above 200D SMA",
    action: "Contribute $500",
    color: "#3b82f6",
    note: "Normal accumulation range — standard DCA",
  },
  {
    zone: "Standard Buy (High)",
    condition: "Price 25–50% above 200D SMA",
    action: "Contribute $300",
    color: "#eab308",
    note: "Elevated prices — reduce contribution size",
  },
  {
    zone: "Take Profit Zone",
    condition: "Price ≥ 50% above 200D SMA",
    action: "Contribute $0",
    color: "#ef4444",
    note: "Overheated — no new buys, manage exits only",
  },
];

const TAKE_PROFIT_ROWS = [
  {
    tranche: "Tranche 1 — 20%",
    trigger: "Price ≥ 50% above 200D SMA",
    action: "Sell 20% of BTC holdings",
    color: "#f97316",
  },
  {
    tranche: "Tranche 2 — 20%",
    trigger: "Price ≥ 80% above 200D SMA",
    action: "Sell another 20% of BTC holdings",
    color: "#ef4444",
  },
  {
    tranche: "Tranche 3 — 20%",
    trigger: "Price ≥ 100% above 200D SMA (2×)",
    action: "Sell another 20% of BTC holdings",
    color: "#dc2626",
  },
];

export default function Strategy() {
  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-8 pb-16">

      {/* Page Header */}
      <motion.div {...fadeUp(0)} className="border-b border-border pb-5">
        <h1 className="text-2xl md:text-3xl font-black text-foreground">
          Bitcoin &amp; CASH.to Dynamic Strategy
        </h1>
        <p className="text-muted-foreground text-sm mt-1 font-mono">
          Questrade V3.1 &nbsp;·&nbsp; $0-commission execution &nbsp;·&nbsp; Idle cash parked in CASH.to
        </p>
      </motion.div>

      {/* Core Principle */}
      <motion.div {...fadeUp(0.05)}>
        <Card className="bg-card border-border">
          <CardHeader className="p-5 pb-3">
            <SectionHeading icon={ShieldCheck} title="Core Principle" />
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-3 text-sm text-muted-foreground leading-relaxed">
            <p>
              This strategy uses <strong className="text-foreground">Questrade's $0 commission</strong> on ETF purchases to implement a disciplined, zone-based DCA (Dollar-Cost Averaging) approach to Bitcoin accumulation. It is designed for long-term investors who want to buy more aggressively at cycle lows and reduce exposure at cycle highs — automatically, without emotion.
            </p>
            <div className="flex items-start gap-2 bg-primary/10 border border-primary/25 rounded-lg p-3 text-foreground">
              <Banknote className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p>
                <strong>Cash is never idle.</strong> Any capital not deployed into BTC is parked in{" "}
                <strong className="text-primary">CASH.to</strong> (Purpose Cash Management Trust ETF), earning high-interest returns until the next contribution date.
              </p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Accumulation Table */}
      <motion.div {...fadeUp(0.1)}>
        <Card className="bg-card border-border">
          <CardHeader className="p-5 pb-3">
            <SectionHeading icon={TrendingUp} title="Accumulation Rules — Bi-Monthly Contributions" color="text-emerald-400" />
            <p className="text-xs text-muted-foreground mt-1">
              Contributions on the <strong className="text-foreground">1st and 15th</strong> of each month. Check the dashboard the evening before to confirm zone.
            </p>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2.5 pr-4 text-xs font-bold uppercase tracking-widest text-muted-foreground w-36">Zone</th>
                    <th className="py-2.5 pr-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Condition</th>
                    <th className="py-2.5 pr-4 text-xs font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">Contribution</th>
                    <th className="py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground hidden md:table-cell">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {ACCUMULATION_ROWS.map((row, i) => (
                    <tr key={row.zone} className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="py-3 pr-4 font-semibold whitespace-nowrap" style={{ color: row.color }}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                          {row.zone}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground font-mono text-xs leading-snug">{row.condition}</td>
                      <td className="py-3 pr-4 font-black text-foreground font-mono whitespace-nowrap">{row.action}</td>
                      <td className="py-3 text-muted-foreground text-xs hidden md:table-cell">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Take Profit Ladder */}
      <motion.div {...fadeUp(0.15)}>
        <Card className="bg-card border-border">
          <CardHeader className="p-5 pb-3">
            <SectionHeading icon={TrendingDown} title="Take Profit Rules — Ladder-Out Tranches" color="text-red-400" />
            <p className="text-xs text-muted-foreground mt-1">
              Sell checks on <strong className="text-foreground">Sunday nights</strong> using the weekly close. Each sell is 20% of your <em>total BTC position</em> at that moment.
            </p>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2.5 pr-4 text-xs font-bold uppercase tracking-widest text-muted-foreground w-40">Tranche</th>
                    <th className="py-2.5 pr-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">Trigger</th>
                    <th className="py-2.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {TAKE_PROFIT_ROWS.map((row, i) => (
                    <tr key={row.tranche} className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="py-3 pr-4 font-semibold whitespace-nowrap" style={{ color: row.color }}>
                        {row.tranche}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{row.trigger}</td>
                      <td className="py-3 font-bold text-foreground">{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-3 rounded-lg bg-red-950/20 border border-red-900/30 text-xs text-muted-foreground">
              <strong className="text-foreground">After selling:</strong> All proceeds go immediately into <strong className="text-primary">CASH.to</strong> to earn interest while waiting for the next accumulation opportunity. Sold tranches are re-bought only when the zone re-enters Aggressive Buy or better.
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Execution Schedule */}
      <motion.div {...fadeUp(0.2)}>
        <Card className="bg-card border-border">
          <CardHeader className="p-5 pb-3">
            <SectionHeading icon={CalendarClock} title="Execution Schedule" />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <p className="font-bold text-foreground">Buy Schedule</p>
                <ul className="space-y-1.5 text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="text-primary font-mono font-bold">1st</span>
                    <span>Check dashboard the evening before. Execute contribution on market open.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-primary font-mono font-bold">15th</span>
                    <span>Repeat. Zone may have shifted — always use the live reading.</span>
                  </li>
                </ul>
              </div>
              <div className="space-y-2">
                <p className="font-bold text-foreground">Sell Schedule</p>
                <ul className="space-y-1.5 text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="text-red-400 font-mono font-bold">Sun</span>
                    <span>Check weekly close every Sunday night. Execute any triggered sell tranches before Monday open.</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Indicators Reference */}
      <motion.div {...fadeUp(0.25)}>
        <Card className="bg-card border-border">
          <CardHeader className="p-5 pb-3">
            <SectionHeading icon={Info} title="Indicator Reference" color="text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="rounded-lg border border-red-900/30 p-4 bg-red-950/10 space-y-1">
                <p className="font-bold text-sm" style={{ color: "#ef4444" }}>200-Week WMA</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Weighted Moving Average of the weekly close over 200 weeks (~4 years). The most recent weeks are weighted most heavily. Historically marks the absolute cycle floor — touching it is extremely rare.
                </p>
              </div>
              <div className="rounded-lg border border-blue-900/30 p-4 bg-blue-950/10 space-y-1">
                <p className="font-bold text-sm" style={{ color: "#3b82f6" }}>20-Week EMA</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Exponential Moving Average of the weekly close over 20 weeks (~5 months). Reacts faster to recent price changes. Dropping below it often signals a mid-cycle correction or bear market entry.
                </p>
              </div>
              <div className="rounded-lg border border-yellow-900/30 p-4 bg-yellow-950/10 space-y-1">
                <p className="font-bold text-sm" style={{ color: "#eab308" }}>200-Day SMA</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Simple Moving Average of the daily close over 200 trading days. Used as the baseline for profit-taking decisions. Extensions of 50%, 80%, and 100% above this level are the sell triggers.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

    </div>
  );
}

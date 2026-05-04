import { Router, type Request, type Response } from "express";

const router = Router();

const KRAKEN_BASE = "https://api.kraken.com/0/public";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

type KrakenOhlcRow = [number, string, string, string, string, string, string, number];

interface KrakenOhlcResult {
  error: string[];
  result: {
    XXBTZUSD: KrakenOhlcRow[];
    last: number;
  };
}

interface KrakenTickerResult {
  error: string[];
  result: {
    XXBTZUSD: {
      c: [string, string];
    };
  };
}

interface CoinGeckoMarketChart {
  prices: [number, number][];
}

interface DailyBar {
  date: string;
  price: number;
}

async function fetchUrl(url: string): Promise<globalThis.Response> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${url}`);
  return res;
}

interface CryptoCompareHistoday {
  Data: {
    Data: Array<{ time: number; close: number }>;
  };
}

// Fetch daily BTC close prices from CryptoCompare (2000+ continuous bars, free, no key).
// Falls back to Kraken (~720 bars) if CryptoCompare is unavailable.
async function fetchDailyBars(): Promise<DailyBar[]> {
  const CC_BASE = "https://min-api.cryptocompare.com/data/v2";
  try {
    const res = await fetchUrl(
      `${CC_BASE}/histoday?fsym=BTC&tsym=USD&limit=2000`
    );
    const data = (await res.json()) as CryptoCompareHistoday;
    const rows = data?.Data?.Data;
    if (!Array.isArray(rows) || rows.length === 0) throw new Error("CryptoCompare returned empty");
    const seen = new Set<string>();
    const bars: DailyBar[] = [];
    for (const row of rows) {
      const date = new Date(row.time * 1000).toISOString().split("T")[0];
      if (!seen.has(date) && row.close > 0) { seen.add(date); bars.push({ date, price: row.close }); }
    }
    bars.sort((a, b) => a.date.localeCompare(b.date));
    // Drop today's partial bar — live Kraken ticker is source of truth for today
    if (bars.length > 1) bars.pop();
    return bars;
  } catch {
    // Fallback: Kraken daily (up to ~720 bars)
    const res = await fetchUrl(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=1440`);
    const data = (await res.json()) as KrakenOhlcResult;
    if (data.error?.length) throw new Error("Kraken daily error");
    return data.result.XXBTZUSD
      .map((r) => ({ date: new Date(r[0] * 1000).toISOString().split("T")[0], price: parseFloat(r[4]) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

function calcSMA(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calcEMA(prices: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = new Array(prices.length).fill(null);
  let ema: number | null = null;
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result[i] = null;
    } else if (i === period - 1) {
      ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
      result[i] = ema;
    } else {
      ema = prices[i] * k + (ema as number) * (1 - k);
      result[i] = ema;
    }
  }
  return result;
}

function calcWMA(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    let weightedSum = 0;
    let weightTotal = 0;
    for (let j = 0; j < period; j++) {
      const w = j + 1;
      weightedSum += slice[j] * w;
      weightTotal += w;
    }
    return weightedSum / weightTotal;
  });
}

type BtcZone =
  | "MAX_ACCUMULATION"
  | "AGGRESSIVE_BUY"
  | "STANDARD_BUY_LOW"
  | "STANDARD_BUY_HIGH"
  | "TAKE_PROFIT";

interface ZoneResult {
  zone: BtcZone;
  triggerIndicator: string;
  triggerDetail: string;
}

function determineZone(
  price: number,
  wma200w: number,
  ema20w: number,
  sma200d: number
): ZoneResult {
  const smafmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

  if (price <= wma200w) {
    return {
      zone: "MAX_ACCUMULATION",
      triggerIndicator: "200W WMA",
      triggerDetail: `Price ≤ 200W WMA ($${smafmt(wma200w)})`,
    };
  }

  if (price <= ema20w) {
    return {
      zone: "AGGRESSIVE_BUY",
      triggerIndicator: "20W EMA",
      triggerDetail: `Price ≤ 20W EMA ($${smafmt(ema20w)})`,
    };
  }

  if (price <= sma200d) {
    return {
      zone: "STANDARD_BUY_LOW",
      triggerIndicator: "200D SMA",
      triggerDetail: `Price ≤ 200D SMA ($${smafmt(sma200d)})`,
    };
  }

  // Standard Buy (High): above SMA up to +15%
  if (price < sma200d * 1.15) {
    return {
      zone: "STANDARD_BUY_HIGH",
      triggerIndicator: "200D SMA",
      triggerDetail: `Price within 15% above 200D SMA ($${smafmt(sma200d)})`,
    };
  }

  // Take Profit 1: +15% to +50%
  if (price < sma200d * 1.50) {
    return {
      zone: "TAKE_PROFIT",
      triggerIndicator: "200D SMA",
      triggerDetail: `Price +15% above 200D SMA ($${smafmt(sma200d)}) — TP1`,
    };
  }

  // Take Profit 2: +50% to +75%
  if (price < sma200d * 1.75) {
    return {
      zone: "TAKE_PROFIT",
      triggerIndicator: "200D SMA",
      triggerDetail: `Price +50% above 200D SMA ($${smafmt(sma200d)}) — TP2`,
    };
  }

  // Take Profit 3: +75% and above
  return {
    zone: "TAKE_PROFIT",
    triggerIndicator: "200D SMA",
    triggerDetail: `Price +75% above 200D SMA ($${smafmt(sma200d)}) — TP3`,
  };
}

const ZONE_LABELS: Record<BtcZone, string> = {
  MAX_ACCUMULATION: "Max Accumulation",
  AGGRESSIVE_BUY: "Aggressive Buy",
  STANDARD_BUY_LOW: "Standard Buy (Low)",
  STANDARD_BUY_HIGH: "Standard Buy (High)",
  TAKE_PROFIT: "Take Profit Zone",
};

const ZONE_COLORS: Record<BtcZone, string> = {
  MAX_ACCUMULATION: "#22c55e",
  AGGRESSIVE_BUY: "#4ade80",
  STANDARD_BUY_LOW: "#3b82f6",
  STANDARD_BUY_HIGH: "#eab308",
  TAKE_PROFIT: "#ef4444",
};

const ZONE_ACTIONS: Record<BtcZone, string> = {
  MAX_ACCUMULATION:
    "Contribute $3,000 (6×) — price is at or below the 200W WMA. Deploy maximum capital.",
  AGGRESSIVE_BUY:
    "Contribute $2,000 (4×) — price is below the 20W EMA. Strong buy signal.",
  STANDARD_BUY_LOW:
    "Contribute $1,000 (2×) — price is at or below the 200D SMA. Standard DCA range.",
  STANDARD_BUY_HIGH:
    "Contribute $500 (1×) — price is within 15% above the 200D SMA. Base contribution.",
  TAKE_PROFIT:
    "Contribute $0 — price is 15%+ above the 200D SMA. No new buys; manage exits only.",
};

interface RawBtcData {
  dailyDates: string[];
  dailyPrices: number[];
  sma200dArr: (number | null)[];
  weeklyDates: string[];
  ema20wArr: (number | null)[];
  wma200wArr: (number | null)[];
  currentPrice: number;
}

let cache: {
  dashboard: unknown;
  chart: unknown;
  raw: RawBtcData;
  timestamp: number;
} | null = null;

const CACHE_TTL = 10 * 60 * 1000;
let fetchInFlight: Promise<typeof cache> | null = null;

async function fetchBtcData() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
    return cache;
  }
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    try {
      const [dailyBars, weeklyRes, tickerRes] = await Promise.all([
        fetchDailyBars(),
        fetchUrl(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=10080`),
        fetchUrl(`${KRAKEN_BASE}/Ticker?pair=XBTUSD`),
      ]);

      const weeklyData = (await weeklyRes.json()) as KrakenOhlcResult;
      const tickerData = (await tickerRes.json()) as KrakenTickerResult;

      if (weeklyData.error?.length) throw new Error("Kraken weekly error");

      // Sort weekly rows ascending by timestamp (Kraken should already do this,
      // but guard against any edge-case ordering differences)
      const weeklyRows = [...weeklyData.result.XXBTZUSD].sort((a, b) => a[0] - b[0]);

      const dailyPrices = dailyBars.map((b) => b.price);
      const dailyDates = dailyBars.map((b) => b.date);
      const weeklyPrices = weeklyRows.map((r) => parseFloat(r[4]));
      const weeklyDates = weeklyRows.map((r) =>
        new Date(r[0] * 1000).toISOString().split("T")[0]
      );

      const currentPrice = parseFloat(tickerData.result.XXBTZUSD.c[0]);

      const sma200dArr = calcSMA(dailyPrices, 200);
      const ema20wArr = calcEMA(weeklyPrices, 20);
      const wma200wArr = calcWMA(weeklyPrices, 200);

      const latestSma200d = sma200dArr.filter((v) => v !== null).at(-1) as number;
      const latestEma20w = ema20wArr.filter((v) => v !== null).at(-1) as number;
      const latestWma200w = wma200wArr.filter((v) => v !== null).at(-1) as number;

      const pctFromWma200w = ((currentPrice - latestWma200w) / latestWma200w) * 100;
      const pctFromEma20w = ((currentPrice - latestEma20w) / latestEma20w) * 100;
      const pctFromSma200d = ((currentPrice - latestSma200d) / latestSma200d) * 100;

      const zoneResult = determineZone(currentPrice, latestWma200w, latestEma20w, latestSma200d);

      const dashboard = {
        currentPrice,
        wma200w: latestWma200w,
        ema20w: latestEma20w,
        sma200d: latestSma200d,
        zone: zoneResult.zone,
        zoneLabel: ZONE_LABELS[zoneResult.zone],
        zoneColor: ZONE_COLORS[zoneResult.zone],
        actionText: ZONE_ACTIONS[zoneResult.zone],
        triggerIndicator: zoneResult.triggerIndicator,
        triggerDetail: zoneResult.triggerDetail,
        pctFromWma200w: parseFloat(pctFromWma200w.toFixed(2)),
        pctFromEma20w: parseFloat(pctFromEma20w.toFixed(2)),
        pctFromSma200d: parseFloat(pctFromSma200d.toFixed(2)),
        dailyCandlesUsed: dailyPrices.length,
        weeklyCandlesUsed: weeklyPrices.length,
        lastUpdated: new Date().toISOString(),
      };

      // Build chart: last 2 years of daily data, but never start before all
      // indicators are valid so every line extends to the left edge of the chart.
      const chartWindowDays = 730;
      const firstValidSmaIdx = sma200dArr.findIndex((v) => v !== null);
      // Also find the first daily date where the weekly EMA is valid
      const firstValidEmaWeeklyIdx = ema20wArr.findIndex((v) => v !== null);
      const firstEmaDate = firstValidEmaWeeklyIdx >= 0 ? weeklyDates[firstValidEmaWeeklyIdx] : null;
      const firstValidEmaDailyIdx = firstEmaDate
        ? Math.max(0, dailyDates.findIndex((d) => d >= firstEmaDate))
        : 0;
      const firstValidWmaWeeklyIdx = wma200wArr.findIndex((v) => v !== null);
      const firstWmaDate = firstValidWmaWeeklyIdx >= 0 ? weeklyDates[firstValidWmaWeeklyIdx] : null;
      const firstValidWmaDailyIdx = firstWmaDate
        ? Math.max(0, dailyDates.findIndex((d) => d >= firstWmaDate))
        : 0;
      const firstValidIdx = Math.max(firstValidSmaIdx, firstValidEmaDailyIdx, firstValidWmaDailyIdx);
      const chartStartIdx = Math.max(firstValidIdx, dailyDates.length - chartWindowDays);

      let lastWeeklyIdx = 0;
      const points = dailyDates.slice(chartStartIdx).map((date, idx) => {
        const absIdx = chartStartIdx + idx;
        while (
          lastWeeklyIdx + 1 < weeklyDates.length &&
          weeklyDates[lastWeeklyIdx + 1] <= date
        ) {
          lastWeeklyIdx++;
        }
        return {
          date,
          price: dailyPrices[absIdx],
          wma200w: wma200wArr[lastWeeklyIdx] ?? null,
          ema20w: ema20wArr[lastWeeklyIdx] ?? null,
          sma200d: sma200dArr[absIdx] ?? null,
        };
      });

      const chartResponse = { points, currentZone: zoneResult.zone };

      const raw: RawBtcData = {
        dailyDates,
        dailyPrices,
        sma200dArr,
        weeklyDates,
        ema20wArr,
        wma200wArr,
        currentPrice,
      };

      cache = { dashboard, chart: chartResponse, raw, timestamp: Date.now() };
      return cache;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

// ─── Backtest engine ──────────────────────────────────────────────────────────

const ZONE_MULTIPLIERS: Record<BtcZone, number> = {
  MAX_ACCUMULATION: 6.0,
  AGGRESSIVE_BUY: 4.0,
  STANDARD_BUY_LOW: 2.0,
  STANDARD_BUY_HIGH: 1.0,
  TAKE_PROFIT: 0.0,
};

function computeBacktest(
  raw: RawBtcData,
  startDate: string,
  baseInstallment: number,
  startingCash: number
) {
  const { dailyDates, dailyPrices, sma200dArr, weeklyDates, ema20wArr, wma200wArr } = raw;

  // Forward-fill weekly indicators onto daily dates
  const dailyWma: (number | null)[] = [];
  const dailyEma: (number | null)[] = [];
  let wi = 0;
  for (let i = 0; i < dailyDates.length; i++) {
    while (wi + 1 < weeklyDates.length && weeklyDates[wi + 1] <= dailyDates[i]) wi++;
    dailyWma.push(wma200wArr[wi] ?? null);
    dailyEma.push(ema20wArr[wi] ?? null);
  }

  let startIdx = dailyDates.findIndex((d) => d >= startDate);
  if (startIdx === -1) startIdx = 0;

  const DAILY_RATE = 0.04 / 365;
  let btcHoldings = 0;
  let cashBalance = startingCash;
  let totalInvested = 0;
  let tp1 = false, tp2 = false, tp3 = false;
  let dcaBtc = 0, dcaInvested = 0;
  let peakValue = startingCash;

  const history: Array<{
    date: string; portfolioValue: number; btcValue: number;
    cashBalance: number; dcaValue: number; price: number; zone: string;
  }> = [];
  const trades: Array<{
    date: string; type: string; zone: string; label: string;
    price: number; amount: number; btcDelta: number;
  }> = [];
  const zoneMap: Record<string, { count: number; totalDeployed: number }> = {};

  let maxDrawdownPct = 0;

  for (let i = startIdx; i < dailyDates.length; i++) {
    const date = dailyDates[i];
    const price = dailyPrices[i];
    const sma200d = sma200dArr[i];
    const wma200w = dailyWma[i];
    const ema20w = dailyEma[i];
    if (sma200d === null || wma200w === null || ema20w === null) continue;

    // Daily interest on cash
    cashBalance *= 1 + DAILY_RATE;

    const zoneResult = determineZone(price, wma200w, ema20w, sma200d);
    const zone = zoneResult.zone;

    // Reset TP flags when price drops back below the hysteresis band.
    // SMA×1.10 gives a buffer below the TP1 trigger at 1.15 — prevents
    // whipsaw re-fires while still allowing fresh tranches after a real pullback.
    if (price < sma200d * 1.10) { tp1 = false; tp2 = false; tp3 = false; }

    // Take-profit sells: check TP1 → TP2 → TP3 in order; one tranche per day
    const tpChecks: [boolean, string, string, number][] = [
      [tp1, "tp1", "TP1 +15%", 1.15],
      [tp2, "tp2", "TP2 +50%", 1.50],
      [tp3, "tp3", "TP3 +75%", 1.75],
    ];
    for (const [triggered, key, label, mult] of tpChecks) {
      if (!triggered && price >= sma200d * mult && btcHoldings > 0) {
        const sellBtc = btcHoldings * 0.25;
        const proceeds = sellBtc * price;
        btcHoldings -= sellBtc;
        cashBalance += proceeds;
        if (key === "tp1") tp1 = true;
        else if (key === "tp2") tp2 = true;
        else tp3 = true;
        trades.push({ date, type: "SELL", zone, label, price, amount: proceeds, btcDelta: -sellBtc });
        break; // one tranche per day; next tranche fires the following eligible day
      }
    }

    // Bi-monthly contributions on 1st and 15th
    const dom = parseInt(date.split("-")[2], 10);
    if (dom === 1 || dom === 15) {
      const multiplier = ZONE_MULTIPLIERS[zone];
      const contribution = baseInstallment * multiplier;
      if (contribution > 0) {
        const btcBought = contribution / price;
        btcHoldings += btcBought;
        totalInvested += contribution;
        trades.push({ date, type: "BUY", zone, label: ZONE_LABELS[zone], price, amount: contribution, btcDelta: btcBought });
        if (!zoneMap[zone]) zoneMap[zone] = { count: 0, totalDeployed: 0 };
        zoneMap[zone].count++;
        zoneMap[zone].totalDeployed += contribution;
      }
      // Simple DCA benchmark
      dcaBtc += baseInstallment / price;
      dcaInvested += baseInstallment;
    }

    const btcValue = btcHoldings * price;
    const portfolioValue = btcValue + cashBalance;
    const dcaValue = dcaBtc * price + startingCash;

    if (portfolioValue > peakValue) peakValue = portfolioValue;
    const dd = peakValue > 0 ? ((portfolioValue - peakValue) / peakValue) * 100 : 0;
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;

    history.push({ date, portfolioValue, btcValue, cashBalance, dcaValue, price, zone });
  }

  const last = history.at(-1);
  const finalValue = last?.portfolioValue ?? startingCash;
  const btcValueFinal = last?.btcValue ?? 0;
  const cashFinal = last?.cashBalance ?? startingCash;
  const dcaFinalValue = last?.dcaValue ?? startingCash;
  const netProfit = finalValue - totalInvested - startingCash;
  const returnPct = (totalInvested + startingCash) > 0
    ? (netProfit / (totalInvested + startingCash)) * 100 : 0;

  const zoneStats = Object.entries(zoneMap).map(([z, s]) => ({
    zone: z,
    label: ZONE_LABELS[z as BtcZone] ?? z,
    count: s.count,
    totalDeployed: s.totalDeployed,
    color: ZONE_COLORS[z as BtcZone] ?? "#94a3b8",
  }));

  return {
    startDate: dailyDates[startIdx] ?? startDate,
    endDate: dailyDates.at(-1) ?? startDate,
    baseInstallment,
    startingCash,
    summary: {
      finalValue,
      totalInvested,
      netProfit,
      returnPct,
      maxDrawdown: maxDrawdownPct,
      dcaFinalValue,
      dcaTotalInvested: dcaInvested,
      outperformance: finalValue - dcaFinalValue,
      btcValue: btcValueFinal,
      cashBalance: cashFinal,
      numContributions: trades.filter((t) => t.type === "BUY").length,
      numSells: trades.filter((t) => t.type === "SELL").length,
    },
    history,
    trades,
    zoneStats,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/btc/dashboard", async (req: Request, res: Response) => {
  try {
    const data = await fetchBtcData();
    res.json(data!.dashboard);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch BTC dashboard data");
    res.status(500).json({ error: "Failed to fetch Bitcoin data. Please try again in a moment." });
  }
});

router.get("/btc/chart", async (req: Request, res: Response) => {
  try {
    const data = await fetchBtcData();
    res.json(data!.chart);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch BTC chart data");
    res.status(500).json({ error: "Failed to fetch chart data." });
  }
});

router.get("/btc/backtest", async (req: Request, res: Response) => {
  try {
    const data = await fetchBtcData();
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
    const baseInstallment = Math.max(1, parseFloat(req.query.baseInstallment as string) || 500);
    const startingCash = Math.max(0, parseFloat(req.query.startingCash as string) || 0);
    if (!startDate) {
      res.status(400).json({ error: "startDate query parameter is required (YYYY-MM-DD)" });
      return;
    }
    const result = computeBacktest(data!.raw, startDate, baseInstallment, startingCash);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to run backtest");
    res.status(500).json({ error: "Backtest failed. Please try again." });
  }
});

export default router;

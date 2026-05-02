import { Router, type Request, type Response } from "express";

const router = Router();

// Kraken public REST API — no auth, globally accessible
const KRAKEN_BASE = "https://api.kraken.com/0/public";

// OHLC row: [time, open, high, low, close, vwap, volume, count]
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

async function fetchUrl(url: string): Promise<globalThis.Response> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Kraken API returned ${res.status}`);
  return res;
}

/** Fetch up to maxPages * 720 daily candles by walking backwards with `since` */
async function fetchDailyCandles(targetDays: number): Promise<KrakenOhlcRow[]> {
  const allRows: KrakenOhlcRow[] = [];
  const seenTimes = new Set<number>();

  // Page 1: most recent 720 days (no since param)
  const page1Res = await fetchUrl(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=1440`);
  const page1 = (await page1Res.json()) as KrakenOhlcResult;
  if (page1.error?.length) throw new Error("Kraken error: " + JSON.stringify(page1.error));
  for (const row of page1.result.XXBTZUSD) {
    if (!seenTimes.has(row[0])) { seenTimes.add(row[0]); allRows.push(row); }
  }

  // If we need more, fetch an earlier page using the oldest timestamp we have
  if (allRows.length < targetDays && allRows.length > 0) {
    const oldestTs = Math.min(...allRows.map((r) => r[0]));
    // Go back targetDays from now; since is in seconds
    const sinceTs = Math.floor(Date.now() / 1000) - targetDays * 86400;
    const page2Res = await fetchUrl(
      `${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=1440&since=${sinceTs}`
    );
    const page2 = (await page2Res.json()) as KrakenOhlcResult;
    if (!page2.error?.length) {
      for (const row of page2.result.XXBTZUSD) {
        if (!seenTimes.has(row[0]) && row[0] < oldestTs) {
          seenTimes.add(row[0]);
          allRows.push(row);
        }
      }
    }
  }

  // Sort ascending by timestamp
  allRows.sort((a, b) => a[0] - b[0]);
  return allRows;
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

// Linear Weighted Moving Average: most recent price gets weight N, oldest gets weight 1
function calcWMA(prices: number[], period: number): (number | null)[] {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    let weightedSum = 0;
    let weightTotal = 0;
    for (let j = 0; j < period; j++) {
      const w = j + 1; // weight 1 = oldest, weight N = newest
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
  if (price <= wma200w) {
    return {
      zone: "MAX_ACCUMULATION",
      triggerIndicator: "200W WMA",
      triggerDetail: `Price ≤ 200W WMA ($${wma200w.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
    };
  }
  if (price <= ema20w) {
    return {
      zone: "AGGRESSIVE_BUY",
      triggerIndicator: "20W EMA",
      triggerDetail: `Price ≤ 20W EMA ($${ema20w.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
    };
  }
  const sma125 = sma200d * 1.25;
  const sma150 = sma200d * 1.5;
  if (price <= sma125) {
    return {
      zone: "STANDARD_BUY_LOW",
      triggerIndicator: "200D SMA",
      triggerDetail: `Price within 25% of 200D SMA ($${sma200d.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
    };
  }
  if (price < sma150) {
    return {
      zone: "STANDARD_BUY_HIGH",
      triggerIndicator: "200D SMA",
      triggerDetail: `Price 25–50% above 200D SMA ($${sma200d.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
    };
  }
  return {
    zone: "TAKE_PROFIT",
    triggerIndicator: "200D SMA",
    triggerDetail: `Price ≥ 50% above 200D SMA ($${sma200d.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
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
    "Double your contribution ($1,000) — price is at or below the 200W WMA. Deploy maximum capital.",
  AGGRESSIVE_BUY:
    "Contribute $750 — price is below the 20W EMA. Strong buy signal.",
  STANDARD_BUY_LOW:
    "Contribute $500 — standard DCA range.",
  STANDARD_BUY_HIGH:
    "Contribute $300 — price is 25–50% above 200D SMA. Reduce contribution size.",
  TAKE_PROFIT:
    "Contribute $0 — price is 50%+ above 200D SMA. No new buys; manage exits only.",
};

// Cache for 10 minutes
let cache: {
  dashboard: unknown;
  chart: unknown;
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
      // Fetch daily (1440+ days via pagination), weekly (720 weeks), and current price in parallel
      const [dailyRows, weeklyRes, tickerRes] = await Promise.all([
        fetchDailyCandles(1440),
        fetchUrl(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=10080`),
        fetchUrl(`${KRAKEN_BASE}/Ticker?pair=XBTUSD`),
      ]);

      const weeklyData = (await weeklyRes.json()) as KrakenOhlcResult;
      const tickerData = (await tickerRes.json()) as KrakenTickerResult;

      if (weeklyData.error?.length) throw new Error("Kraken weekly error");

      const weeklyRows = weeklyData.result.XXBTZUSD;

      const dailyPrices = dailyRows.map((r) => parseFloat(r[4]));
      const dailyDates = dailyRows.map((r) =>
        new Date(r[0] * 1000).toISOString().split("T")[0]
      );
      const weeklyPrices = weeklyRows.map((r) => parseFloat(r[4]));
      const weeklyDates = weeklyRows.map((r) =>
        new Date(r[0] * 1000).toISOString().split("T")[0]
      );

      // Real-time last trade price
      const currentPrice = parseFloat(tickerData.result.XXBTZUSD.c[0]);

      // Calculate indicators
      const sma200dArr = calcSMA(dailyPrices, 200);
      const ema20wArr = calcEMA(weeklyPrices, 20);
      const wma200wArr = calcWMA(weeklyPrices, 200);

      const latestSma200d = sma200dArr.filter((v) => v !== null).at(-1) as number;
      const latestEma20w = ema20wArr.filter((v) => v !== null).at(-1) as number;
      const latestWma200w = wma200wArr.filter((v) => v !== null).at(-1) as number;

      const zoneResult = determineZone(
        currentPrice,
        latestWma200w,
        latestEma20w,
        latestSma200d
      );

      // Percentage distances from each indicator
      const pctFromWma200w = ((currentPrice - latestWma200w) / latestWma200w) * 100;
      const pctFromEma20w = ((currentPrice - latestEma20w) / latestEma20w) * 100;
      const pctFromSma200d = ((currentPrice - latestSma200d) / latestSma200d) * 100;

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

      // Build chart: last 2 years of daily data with weekly indicators mapped to daily dates
      const chartWindowDays = 730;
      const startIdx = Math.max(0, dailyDates.length - chartWindowDays);

      let lastWeeklyIdx = 0;
      const points = dailyDates.slice(startIdx).map((date, idx) => {
        const absIdx = startIdx + idx;
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

      cache = { dashboard, chart: chartResponse, timestamp: Date.now() };
      return cache;
    } finally {
      fetchInFlight = null;
    }
  })();

  return fetchInFlight;
}

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
    res.status(500).json({ error: "Failed to fetch Bitcoin chart data. Please try again." });
  }
});

export default router;

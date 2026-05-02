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
      c: [string, string]; // [last trade price, lot volume]
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

function determineZone(
  price: number,
  wma200w: number,
  ema20w: number,
  sma200d: number
): BtcZone {
  if (price <= wma200w) return "MAX_ACCUMULATION";
  if (price <= ema20w) return "AGGRESSIVE_BUY";
  if (price <= sma200d * 1.25) return "STANDARD_BUY_LOW";
  if (price < sma200d * 1.5) return "STANDARD_BUY_HIGH";
  return "TAKE_PROFIT";
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
    "Rare opportunity — accumulate aggressively. Deploy maximum capital now.",
  AGGRESSIVE_BUY:
    "Strong buy signal — below 20W EMA. Consider doubling your regular contribution.",
  STANDARD_BUY_LOW: "Standard Buy: Contribute your regular DCA amount today.",
  STANDARD_BUY_HIGH:
    "Elevated but not extreme. Continue standard DCA with caution.",
  TAKE_PROFIT:
    "Price is 50%+ above 200D SMA. Consider taking partial profits.",
};

// Cache for 10 minutes to reduce API calls
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

  if (fetchInFlight) {
    return fetchInFlight;
  }

  fetchInFlight = (async () => {
    try {
      // Kraken OHLC max 720 candles per request
      // daily = 1440 min interval → 720 days ≈ 2 years (enough for 200D SMA)
      // weekly = 10080 min interval → 720 weeks ≈ 13.8 years (enough for 200W WMA)
      const [dailyRes, weeklyRes, tickerRes] = await Promise.all([
        fetchUrl(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=1440`),
        fetchUrl(`${KRAKEN_BASE}/OHLC?pair=XBTUSD&interval=10080`),
        fetchUrl(`${KRAKEN_BASE}/Ticker?pair=XBTUSD`),
      ]);

      const dailyData = (await dailyRes.json()) as KrakenOhlcResult;
      const weeklyData = (await weeklyRes.json()) as KrakenOhlcResult;
      const tickerData = (await tickerRes.json()) as KrakenTickerResult;

      if (dailyData.error?.length || weeklyData.error?.length) {
        throw new Error("Kraken API error: " + JSON.stringify(dailyData.error));
      }

      const dailyRows = dailyData.result.XXBTZUSD;
      const weeklyRows = weeklyData.result.XXBTZUSD;

      // Extract close prices (index 4) and dates
      const dailyPrices = dailyRows.map((r) => parseFloat(r[4]));
      const dailyDates = dailyRows.map((r) =>
        new Date(r[0] * 1000).toISOString().split("T")[0]
      );
      const weeklyPrices = weeklyRows.map((r) => parseFloat(r[4]));
      const weeklyDates = weeklyRows.map((r) =>
        new Date(r[0] * 1000).toISOString().split("T")[0]
      );

      // Current price from ticker (real-time last trade)
      const currentPrice = parseFloat(tickerData.result.XXBTZUSD.c[0]);

      // Calculate indicators
      const sma200dArr = calcSMA(dailyPrices, 200);
      const ema20wArr = calcEMA(weeklyPrices, 20);
      const wma200wArr = calcWMA(weeklyPrices, 200);

      const latestSma200d = sma200dArr.filter((v) => v !== null).at(-1) as number;
      const latestEma20w = ema20wArr.filter((v) => v !== null).at(-1) as number;
      const latestWma200w = wma200wArr.filter((v) => v !== null).at(-1) as number;

      const zone = determineZone(
        currentPrice,
        latestWma200w,
        latestEma20w,
        latestSma200d
      );

      const dashboard = {
        currentPrice,
        wma200w: latestWma200w,
        ema20w: latestEma20w,
        sma200d: latestSma200d,
        zone,
        zoneLabel: ZONE_LABELS[zone],
        zoneColor: ZONE_COLORS[zone],
        actionText: ZONE_ACTIONS[zone],
        lastUpdated: new Date().toISOString(),
      };

      // Build chart with the last 2 years of daily data
      // Map weekly indicators to each daily date using lookback
      const chartWindowDays = 730;
      const startIdx = Math.max(0, dailyDates.length - chartWindowDays);

      let lastWeeklyIdx = 0;
      const points = dailyDates.slice(startIdx).map((date, idx) => {
        const absIdx = startIdx + idx;

        // Advance weekly pointer while next weekly date is still ≤ current daily date
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

      const chartResponse = {
        points,
        currentZone: zone,
      };

      cache = {
        dashboard,
        chart: chartResponse,
        timestamp: Date.now(),
      };

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
    res
      .status(500)
      .json({ error: "Failed to fetch Bitcoin data. Please try again in a moment." });
  }
});

router.get("/btc/chart", async (req: Request, res: Response) => {
  try {
    const data = await fetchBtcData();
    res.json(data!.chart);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch BTC chart data");
    res
      .status(500)
      .json({ error: "Failed to fetch Bitcoin chart data. Please try again." });
  }
});

export default router;

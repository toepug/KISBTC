export const config = { runtime: "edge" };

const CACHE_DURATION = 10 * 60 * 1000;
let cache = null;
let cacheTime = 0;

function calcSMA200(dailyCloses) {
  const slice = dailyCloses.slice(-200);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcEMA20W(weeklyCloses) {
  const k = 2 / (20 + 1);
  let ema = weeklyCloses.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  for (let i = 20; i < weeklyCloses.length; i++) {
    ema = weeklyCloses[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcWMA200W(weeklyCloses) {
  const slice = weeklyCloses.slice(-200);
  const denom = (200 * 201) / 2;
  let num = 0;
  for (let i = 0; i < slice.length; i++) num += slice[i] * (i + 1);
  return num / denom;
}

const ZONES = [
  {
    key: "MAX_ACCUMULATION",
    label: "Max Accumulation",
    color: "#22c55e",
    actionText: "Maximum accumulation zone — stack hard.",
    triggerIndicator: "200W WMA",
  },
  {
    key: "AGGRESSIVE_BUY",
    label: "Aggressive Buy",
    color: "#86efac",
    actionText: "Aggressive buy zone — increase position.",
    triggerIndicator: "20W EMA",
  },
  {
    key: "STANDARD_BUY_LOW",
    label: "Standard Buy (Low)",
    color: "#3b82f6",
    actionText: "Standard buy zone (low) — DCA as planned.",
    triggerIndicator: "200D SMA",
  },
  {
    key: "STANDARD_BUY_HIGH",
    label: "Standard Buy (High)",
    color: "#facc15",
    actionText: "Standard buy zone (high) — DCA as planned.",
    triggerIndicator: "200D SMA ×1.15",
  },
  {
    key: "TAKE_PROFIT_1",
    label: "Take Profit — TP1",
    color: "#f97316",
    actionText: "TP1 zone — consider selling 25% of holdings.",
    triggerIndicator: "200D SMA ×1.50",
  },
  {
    key: "TAKE_PROFIT_2",
    label: "Take Profit — TP2",
    color: "#ef4444",
    actionText: "TP2 zone — consider selling another 25%.",
    triggerIndicator: "200D SMA ×1.75",
  },
  {
    key: "TAKE_PROFIT_3",
    label: "Take Profit — TP3",
    color: "#7f1d1d",
    actionText: "TP3 zone — consider selling another 25%.",
    triggerIndicator: "200D SMA ×1.75+",
  },
];

function determineZone(price, wma200w, ema20w, sma200d) {
  if (price <= wma200w) return { ...ZONES[0], triggerDetail: `Price ≤ 200W WMA ($${wma200w.toFixed(2)})` };
  if (price <= ema20w) return { ...ZONES[1], triggerDetail: `Price ≤ 20W EMA ($${ema20w.toFixed(2)})` };
  if (price <= sma200d) return { ...ZONES[2], triggerDetail: `Price ≤ 200D SMA ($${sma200d.toFixed(2)})` };
  if (price < sma200d * 1.15) return { ...ZONES[3], triggerDetail: `Price < 200D SMA ×1.15 ($${(sma200d * 1.15).toFixed(2)})` };
  if (price < sma200d * 1.50) return { ...ZONES[4], triggerDetail: `Price < 200D SMA ×1.50 ($${(sma200d * 1.50).toFixed(2)})` };
  if (price < sma200d * 1.75) return { ...ZONES[5], triggerDetail: `Price < 200D SMA ×1.75 ($${(sma200d * 1.75).toFixed(2)})` };
  return { ...ZONES[6], triggerDetail: `Price ≥ 200D SMA ×1.75 ($${(sma200d * 1.75).toFixed(2)})` };
}

function pct(price, indicator) {
  return ((price - indicator) / indicator) * 100;
}

export default async function handler(req) {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_DURATION) {
    return new Response(JSON.stringify(cache), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const [dailyRes, weeklyRes, tickerRes] = await Promise.all([
    fetch("https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000"),
    fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080"),
    fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD"),
  ]);

  const [dailyJson, weeklyJson, tickerJson] = await Promise.all([
    dailyRes.json(),
    weeklyRes.json(),
    tickerRes.json(),
  ]);

  const dailyData = dailyJson.Data.Data.slice(0, -1);
  const dailyCloses = dailyData.map((d) => d.close);

  const weeklyRaw = weeklyJson.result.XBTUSD ?? weeklyJson.result.XXBTZUSD;
  const weeklyCloses = weeklyRaw.map((bar) => parseFloat(bar[4]));

  const tickerResult = tickerJson.result.XXBTZUSD ?? tickerJson.result.XBTUSD;
  const currentPrice = parseFloat(tickerResult.c[0]);

  const sma200d = calcSMA200(dailyCloses);
  const ema20w = calcEMA20W(weeklyCloses);
  const wma200w = calcWMA200W(weeklyCloses);
  const zoneInfo = determineZone(currentPrice, wma200w, ema20w, sma200d);

  const result = {
    currentPrice,
    wma200w,
    ema20w,
    sma200d,
    zone: zoneInfo.key,
    zoneLabel: zoneInfo.label,
    zoneColor: zoneInfo.color,
    actionText: zoneInfo.actionText,
    triggerIndicator: zoneInfo.triggerIndicator,
    triggerDetail: zoneInfo.triggerDetail,
    pctFromSma200d: pct(currentPrice, sma200d),
    pctFromEma20w: pct(currentPrice, ema20w),
    pctFromWma200w: pct(currentPrice, wma200w),
    tpLevels: {
      tp1: sma200d * 1.15,
      tp2: sma200d * 1.50,
      tp3: sma200d * 1.75,
    },
    dailyCandlesUsed: dailyCloses.length,
    weeklyCandlesUsed: weeklyCloses.length,
    lastUpdated: new Date().toISOString(),
  };

  cache = result;
  cacheTime = now;

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

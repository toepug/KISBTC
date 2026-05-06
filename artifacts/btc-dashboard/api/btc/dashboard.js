export const config = { runtime: "edge" };

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
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
  const denom = (200 * 201) / 2; // 20100
  let num = 0;
  for (let i = 0; i < slice.length; i++) {
    num += slice[i] * (i + 1);
  }
  return num / denom;
}

function determineZone(price, wma200w, ema20w, sma200d) {
  if (price <= wma200w) return "Max Accumulation";
  if (price <= ema20w) return "Aggressive Buy";
  if (price <= sma200d) return "Standard Buy (Low)";
  if (price < sma200d * 1.15) return "Standard Buy (High)";
  if (price < sma200d * 1.50) return "Take Profit — TP1";
  if (price < sma200d * 1.75) return "Take Profit — TP2";
  return "Take Profit — TP3";
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

  // Daily closes — drop last partial bar
  const dailyData = dailyJson.Data.Data;
  const dailyCloses = dailyData.slice(0, -1).map((d) => d.close);

  // Weekly closes from Kraken OHLC (field index 4 = close)
  const weeklyRaw = weeklyJson.result.XBTUSD ?? weeklyJson.result.XXBTZUSD;
  const weeklyCloses = weeklyRaw.map((bar) => parseFloat(bar[4]));

  // Live price
  const price = parseFloat(tickerJson.result.XXBTZUSD.c[0]);

  const sma200d = calcSMA200(dailyCloses);
  const ema20w = calcEMA20W(weeklyCloses);
  const wma200w = calcWMA200W(weeklyCloses);
  const zone = determineZone(price, wma200w, ema20w, sma200d);

  const result = {
    price,
    sma200d,
    ema20w,
    wma200w,
    zone,
    pctFromSma200d: pct(price, sma200d),
    pctFromEma20w: pct(price, ema20w),
    pctFromWma200w: pct(price, wma200w),
    tpLevels: {
      tp1: sma200d * 1.15,
      tp2: sma200d * 1.50,
      tp3: sma200d * 1.75,
    },
  };

  cache = result;
  cacheTime = now;

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

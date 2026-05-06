export const config = { runtime: "edge" };

const CACHE_DURATION = 10 * 60 * 1000;
let cache = null;
let cacheTime = 0;

function calcSMA200Series(closes) {
  return closes.map((_, i) => {
    if (i < 199) return null;
    const slice = closes.slice(i - 199, i + 1);
    return slice.reduce((a, b) => a + b, 0) / 200;
  });
}

function calcEMA20WSeries(weeklyCloses) {
  const k = 2 / (20 + 1);
  const emas = new Array(weeklyCloses.length).fill(null);
  if (weeklyCloses.length < 20) return emas;
  emas[19] = weeklyCloses.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  for (let i = 20; i < weeklyCloses.length; i++) {
    emas[i] = weeklyCloses[i] * k + emas[i - 1] * (1 - k);
  }
  return emas;
}

function calcWMA200WSeries(weeklyCloses) {
  const denom = (200 * 201) / 2;
  return weeklyCloses.map((_, i) => {
    if (i < 199) return null;
    const slice = weeklyCloses.slice(i - 199, i + 1);
    let num = 0;
    for (let j = 0; j < slice.length; j++) num += slice[j] * (j + 1);
    return num / denom;
  });
}

function forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, weeklyValues) {
  return dailyTimes.map((t) => {
    let val = null;
    for (let i = 0; i < weeklyTimes.length; i++) {
      if (weeklyTimes[i] <= t) val = weeklyValues[i];
      else break;
    }
    return val;
  });
}

function unixToISO(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
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

  // Daily data — drop last partial bar
  const dailyData = dailyJson.Data.Data.slice(0, -1);
  const dailyTimes = dailyData.map((d) => d.time);
  const dailyCloses = dailyData.map((d) => d.close);

  // Weekly data from Kraken
  const weeklyRaw = weeklyJson.result.XBTUSD ?? weeklyJson.result.XXBTZUSD;
  const weeklyTimes = weeklyRaw.map((b) => parseInt(b[0]));
  const weeklyCloses = weeklyRaw.map((b) => parseFloat(b[4]));

  // Current zone from ticker
  const tickerResult = tickerJson.result.XXBTZUSD ?? tickerJson.result.XBTUSD;
  const currentPrice = parseFloat(tickerResult.c[0]);

  // Compute indicator series
  const sma200dSeries = calcSMA200Series(dailyCloses);
  const ema20wSeries = calcEMA20WSeries(weeklyCloses);
  const wma200wSeries = calcWMA200WSeries(weeklyCloses);

  // Forward-fill weekly indicators onto daily timestamps
  const ema20wDaily = forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, ema20wSeries);
  const wma200wDaily = forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, wma200wSeries);

  // Build full points array
  const allPoints = dailyData.map((d, i) => ({
    date: unixToISO(d.time),
    price: d.close,
    sma200d: sma200dSeries[i],
    ema20w: ema20wDaily[i],
    wma200w: wma200wDaily[i],
  }));

  // Find first index where all three indicators are non-null
  const firstValidIdx = allPoints.findIndex(
    (p) => p.sma200d !== null && p.ema20w !== null && p.wma200w !== null
  );

  // Keep last ~2 years but never start before all indicators are valid
  const twoYearsAgo = Math.floor((Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
  const twoYearIdx = dailyTimes.findIndex((t) => t >= twoYearsAgo);
  const startIdx = Math.min(firstValidIdx, twoYearIdx >= 0 ? twoYearIdx : firstValidIdx);

  const points = allPoints.slice(startIdx);

  // Determine current zone
  const sma200d = sma200dSeries[sma200dSeries.length - 1];
  const ema20w = ema20wDaily[ema20wDaily.length - 1];
  const wma200w = wma200wDaily[wma200wDaily.length - 1];

  let currentZone = "STANDARD_BUY_HIGH";
  if (currentPrice <= wma200w) currentZone = "MAX_ACCUMULATION";
  else if (currentPrice <= ema20w) currentZone = "AGGRESSIVE_BUY";
  else if (currentPrice <= sma200d) currentZone = "STANDARD_BUY_LOW";
  else if (currentPrice < sma200d * 1.15) currentZone = "STANDARD_BUY_HIGH";
  else if (currentPrice < sma200d * 1.50) currentZone = "TAKE_PROFIT_1";
  else if (currentPrice < sma200d * 1.75) currentZone = "TAKE_PROFIT_2";
  else currentZone = "TAKE_PROFIT_3";

  const result = { currentZone, points };

  cache = result;
  cacheTime = now;

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

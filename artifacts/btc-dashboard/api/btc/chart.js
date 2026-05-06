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

export default async function handler(req) {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_DURATION) {
    return new Response(JSON.stringify(cache), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const [dailyRes, weeklyRes] = await Promise.all([
    fetch("https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=2000"),
    fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080"),
  ]);

  const [dailyJson, weeklyJson] = await Promise.all([
    dailyRes.json(),
    weeklyRes.json(),
  ]);

  const dailyData = dailyJson.Data.Data.slice(0, -1);
  const dailyTimes = dailyData.map((d) => d.time);
  const dailyCloses = dailyData.map((d) => d.close);

  const weeklyRaw = weeklyJson.result.XBTUSD ?? weeklyJson.result.XXBTZUSD;
  const weeklyTimes = weeklyRaw.map((b) => parseInt(b[0]));
  const weeklyCloses = weeklyRaw.map((b) => parseFloat(b[4]));

  const sma200dSeries = calcSMA200Series(dailyCloses);
  const ema20wSeries = calcEMA20WSeries(weeklyCloses);
  const wma200wSeries = calcWMA200WSeries(weeklyCloses);

  const ema20wDaily = forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, ema20wSeries);
  const wma200wDaily = forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, wma200wSeries);

  const chart = dailyData.map((d, i) => ({
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    sma200d: sma200dSeries[i],
    ema20w: ema20wDaily[i],
    wma200w: wma200wDaily[i],
  }));

  cache = chart;
  cacheTime = now;

  return new Response(JSON.stringify(chart), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

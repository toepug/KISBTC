export const config = { runtime: "edge" };

const CACHE_DURATION = 10 * 60 * 1000;
const cache = new Map();

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

function getZone(price, wma200w, ema20w, sma200d) {
  if (!wma200w || !ema20w || !sma200d) return null;
  if (price <= wma200w) return { key: "MAX_ACCUMULATION", label: "Max Accumulation", multiplier: 6, color: "#22c55e" };
  if (price <= ema20w) return { key: "AGGRESSIVE_BUY", label: "Aggressive Buy", multiplier: 4, color: "#86efac" };
  if (price <= sma200d) return { key: "STANDARD_BUY_LOW", label: "Standard Buy (Low)", multiplier: 2, color: "#3b82f6" };
  if (price < sma200d * 1.15) return { key: "STANDARD_BUY_HIGH", label: "Standard Buy (High)", multiplier: 1, color: "#facc15" };
  return { key: "TAKE_PROFIT", label: "Take Profit", multiplier: 0, color: "#ef4444" };
}

function isContributionDay(dateStr) {
  const day = parseInt(dateStr.slice(8, 10));
  return day === 1 || day === 15;
}

function isSunday(dateStr) {
  return new Date(dateStr + "T00:00:00Z").getUTCDay() === 0;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const startDate = url.searchParams.get("startDate");
  if (!startDate) {
    return new Response(JSON.stringify({ error: "startDate is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const baseInstallment = parseFloat(url.searchParams.get("baseInstallment") ?? "500");
  const startingCash = parseFloat(url.searchParams.get("startingCash") ?? "0");
  const cacheKey = `${startDate}-${baseInstallment}-${startingCash}`;

  const now = Date.now();
  if (cache.has(cacheKey) && now - cache.get(cacheKey).time < CACHE_DURATION) {
    return new Response(JSON.stringify(cache.get(cacheKey).data), {
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
  const dailyTimes = dailyData.map((d) => d.time);
  const dailyCloses = dailyData.map((d) => d.close);

  const weeklyRaw = weeklyJson.result.XBTUSD ?? weeklyJson.result.XXBTZUSD;
  const weeklyTimes = weeklyRaw.map((b) => parseInt(b[0]));
  const weeklyCloses = weeklyRaw.map((b) => parseFloat(b[4]));

  const tickerResult = tickerJson.result.XXBTZUSD ?? tickerJson.result.XBTUSD;
  const lastPrice = parseFloat(tickerResult.c[0]);

  const sma200dSeries = calcSMA200Series(dailyCloses);
  const ema20wSeries = calcEMA20WSeries(weeklyCloses);
  const wma200wSeries = calcWMA200WSeries(weeklyCloses);
  const ema20wDaily = forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, ema20wSeries);
  const wma200wDaily = forwardFillWeeklyToDaily(dailyTimes, weeklyTimes, wma200wSeries);

  const allPoints = dailyData.map((d, i) => ({
    date: unixToISO(d.time),
    price: d.close,
    sma200d: sma200dSeries[i],
    ema20w: ema20wDaily[i],
    wma200w: wma200wDaily[i],
  }));

  let startIdx = allPoints.findIndex((p) => p.date >= startDate && p.sma200d !== null && p.ema20w !== null && p.wma200w !== null);
  if (startIdx === -1) startIdx = allPoints.findIndex((p) => p.sma200d !== null && p.ema20w !== null && p.wma200w !== null);
  const simPoints = allPoints.slice(startIdx);

  // Simulation state
  let btcHeld = 0;
  let cashBalance = startingCash; // only startingCash + TP proceeds + interest; NEVER touched by contributions
  let totalInvested = 0;
  let tp1Fired = false, tp2Fired = false, tp3Fired = false;

  // DCA benchmark
  let dcaBtc = 0;
  let dcaInvested = 0;
  let dcaCash = startingCash; // starting cash also earns 4% APY in DCA benchmark

  const history = [];
  const trades = [];
  const zoneStatsMap = {};
  const DAILY_RATE = 0.04 / 365;

  let peakValue = startingCash;
  let maxDrawdown = 0;

  for (const point of simPoints) {
    const { date, price, sma200d, ema20w, wma200w } = point;
    const zone = getZone(price, wma200w, ema20w, sma200d);

    // Cash earns 4% APY daily
    cashBalance *= (1 + DAILY_RATE);
    dcaCash *= (1 + DAILY_RATE);

    // Reset TP flags when price drops back below SMA * 1.10
    if (sma200d && price < sma200d * 1.10) {
      tp1Fired = false; tp2Fired = false; tp3Fired = false;
    }

    // Take profit sells — check on Sundays only (weekly close)
    if (isSunday(date) && sma200d && btcHeld > 0) {
      if (!tp1Fired && price >= sma200d * 1.15) {
        const btcToSell = btcHeld * 0.25;
        const proceeds = btcToSell * price;
        btcHeld -= btcToSell;
        cashBalance += proceeds;
        tp1Fired = true;
        trades.push({ date, type: "SELL", zone: "TAKE_PROFIT", label: "TP1 +15%", price, amount: proceeds, btcDelta: -btcToSell });
      }
      if (!tp2Fired && price >= sma200d * 1.50) {
        const btcToSell = btcHeld * 0.25;
        const proceeds = btcToSell * price;
        btcHeld -= btcToSell;
        cashBalance += proceeds;
        tp2Fired = true;
        trades.push({ date, type: "SELL", zone: "TAKE_PROFIT", label: "TP2 +50%", price, amount: proceeds, btcDelta: -btcToSell });
      }
      if (!tp3Fired && price >= sma200d * 1.75) {
        const btcToSell = btcHeld * 0.25;
        const proceeds = btcToSell * price;
        btcHeld -= btcToSell;
        cashBalance += proceeds;
        tp3Fired = true;
        trades.push({ date, type: "SELL", zone: "TAKE_PROFIT", label: "TP3 +75%", price, amount: proceeds, btcDelta: -btcToSell });
      }
    }

    // Contributions on 1st and 15th
    // Base installment = fresh external capital (never touches cashBalance)
    // Extra above base = drawn from cashBalance; if insufficient, fall back to base only
    if (isContributionDay(date) && zone && zone.multiplier > 0) {
      const fullContribution = baseInstallment * zone.multiplier;
      const extraNeeded = fullContribution - baseInstallment;
      let contribution = baseInstallment; // always at least base
      if (extraNeeded > 0 && cashBalance >= extraNeeded) {
        contribution = fullContribution;
        cashBalance -= extraNeeded; // draw extra from cashBalance
      }
      const btcBought = contribution / price;
      btcHeld += btcBought;
      totalInvested += contribution;

      trades.push({ date, type: "BUY", zone: zone.key, label: zone.label, price, amount: contribution, btcDelta: btcBought });

      if (!zoneStatsMap[zone.key]) {
        zoneStatsMap[zone.key] = { zone: zone.key, label: zone.label, count: 0, totalDeployed: 0, color: zone.color };
      }
      zoneStatsMap[zone.key].count++;
      zoneStatsMap[zone.key].totalDeployed += contribution;

      // DCA benchmark: fixed baseInstallment every contribution day regardless of zone
      dcaBtc += baseInstallment / price;
      dcaInvested += baseInstallment;
    }

    const btcValue = btcHeld * price;
    const portfolioValue = btcValue + cashBalance;
    const dcaValue = dcaBtc * price + dcaCash;

    if (portfolioValue > peakValue) peakValue = portfolioValue;
    const drawdown = peakValue > 0 ? ((peakValue - portfolioValue) / peakValue) * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;

    history.push({ date, portfolioValue, btcValue, cashBalance, dcaValue, price, zone: "TAKE_PROFIT" });
  }

  const finalPrice = simPoints[simPoints.length - 1]?.price ?? lastPrice;
  const btcValue = btcHeld * finalPrice;
  const finalValue = btcValue + cashBalance;
  const dcaFinalValue = dcaBtc * finalPrice + dcaCash;
  // External capital = starting cash + base contributions (one per contribution day)
  // totalInvested includes extras drawn from startingCash, so we can't use it directly
  const numBuys = trades.filter((t) => t.type === "BUY").length;
  const externalCapital = startingCash + (numBuys * baseInstallment);
  const netProfit = finalValue - externalCapital;
  const returnPct = externalCapital > 0 ? (netProfit / externalCapital) * 100 : 0;

  const result = {
    startDate: simPoints[0]?.date ?? startDate,
    endDate: simPoints[simPoints.length - 1]?.date ?? startDate,
    baseInstallment,
    startingCash,
    summary: {
      finalValue,
      totalInvested,
      netProfit,
      returnPct,
      maxDrawdown,
      dcaFinalValue,
      dcaTotalInvested: dcaInvested,
      outperformance: finalValue - dcaFinalValue,
      btcValue,
      cashBalance,
      numContributions: trades.filter((t) => t.type === "BUY").length,
      numSells: trades.filter((t) => t.type === "SELL").length,
    },
    history,
    trades,
    zoneStats: Object.values(zoneStatsMap),
  };

  cache.set(cacheKey, { time: now, data: result });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// Technical indicator math. All functions accept arrays of numbers (or arrays
// of OHLC candle objects) and return arrays aligned 1:1 with the input, using
// `null` for positions where the indicator is not yet defined. That makes it
// trivial to grab the latest value with `last()`.
//
// Implementations follow the standard (Wilder / MetaTrader) definitions so the
// results line up with what investing.com and TradingView display. Ported
// unchanged from the standalone `gauge` project; only types were added.

import type { Candle } from "./types";

/** A series that is undefined at some positions (leading warm-up, gaps). */
export type Series = (number | null)[];

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average seeded with an SMA of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      seed += values[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** SMA that tolerates leading nulls (used to smooth other indicators). */
export function smaNullable(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (v === null || v === undefined || Number.isNaN(v)) {
        ok = false;
        break;
      }
      sum += v;
    }
    if (ok) out[i] = sum / period;
  }
  return out;
}

/** EMA that tolerates leading nulls. */
export function emaNullable(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) {
      prev = null;
      seed = 0;
      count = 0;
      continue;
    }
    if (prev === null) {
      seed += v;
      count++;
      if (count === period) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out[i] = toRsi(avgGain, avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = toRsi(avgGain, avgLoss);
    }
  }
  return out;
}

function toRsi(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  if (avgGain === 0) return 0;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** True range (Wilder). */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
}

/** Average True Range (Wilder). */
export function atr(candles: Candle[], period = 14): Series {
  const tr = trueRange(candles);
  const out: Series = new Array(candles.length).fill(null);
  let prev = 0;
  let seed = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      seed += tr[i];
      if (i === period - 1) {
        prev = seed / period;
        out[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

/** Slow stochastic. MetaTrader convention STOCH(k, d, slowing). */
export function stochastic(
  candles: Candle[],
  kPeriod = 9,
  dPeriod = 6,
  slowing = 3
): { k: Series; d: Series } {
  const rawK: Series = candles.map((c, i) => {
    if (i < kPeriod - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    return range === 0 ? 50 : ((c.close - ll) / range) * 100;
  });
  const k = smaNullable(rawK, slowing);
  const d = smaNullable(k, dPeriod);
  return { k, d };
}

/** Stochastic RSI. */
export function stochRsi(
  values: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dPeriod = 3
): { k: Series; d: Series } {
  const r = rsi(values, rsiPeriod);
  const raw: Series = r.map((v, i) => {
    if (v === null || i < stochPeriod - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (r[j] === null) return null;
      const rj = r[j] as number;
      if (rj > hh) hh = rj;
      if (rj < ll) ll = rj;
    }
    const range = hh - ll;
    return range === 0 ? 50 : ((v - ll) / range) * 100;
  });
  const k = smaNullable(raw, kSmooth);
  const d = smaNullable(k, dPeriod);
  return { k, d };
}

/** MACD line, signal line and histogram. */
export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): { macd: Series; signal: Series; hist: Series } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: Series = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f === null || s === null ? null : f - s;
  });
  const signal = emaNullable(macdLine, signalPeriod);
  const hist: Series = macdLine.map((v, i) => {
    const sig = signal[i];
    return v === null || sig === null ? null : v - sig;
  });
  return { macd: macdLine, signal, hist };
}

/** Wilder ADX with +DI / -DI. */
export function adx(
  candles: Candle[],
  period = 14
): { adx: Series; plusDI: Series; minusDI: Series } {
  const n = candles.length;
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);
  const tr = new Array<number>(n).fill(0);

  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    const pc = candles[i - 1].close;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - pc),
      Math.abs(candles[i].low - pc)
    );
  }

  // Wilder smoothing. All three series are written at the same indices, so once
  // a smoothed true-range is truthy its +/-DM counterparts are numbers too.
  const smooth = (arr: number[]): Series => {
    const s: Series = new Array(n).fill(null);
    let sum = 0;
    for (let i = 1; i < n; i++) {
      if (i <= period) {
        sum += arr[i];
        if (i === period) s[i] = sum;
      } else {
        s[i] = (s[i - 1] as number) - (s[i - 1] as number) / period + arr[i];
      }
    }
    return s;
  };

  const sTR = smooth(tr);
  const sPlus = smooth(plusDM);
  const sMinus = smooth(minusDM);

  const plusDI: Series = new Array(n).fill(null);
  const minusDI: Series = new Array(n).fill(null);
  const dx: Series = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    const t = sTR[i];
    if (t) {
      plusDI[i] = (100 * (sPlus[i] as number)) / t;
      minusDI[i] = (100 * (sMinus[i] as number)) / t;
      const sum = (plusDI[i] as number) + (minusDI[i] as number);
      dx[i] = sum === 0 ? 0 : (100 * Math.abs((plusDI[i] as number) - (minusDI[i] as number))) / sum;
    }
  }

  const adxLine: Series = new Array(n).fill(null);
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = dx[i];
    if (v === null) continue;
    if (prev === null) {
      seed += v;
      count++;
      if (count === period) {
        prev = seed / period;
        adxLine[i] = prev;
      }
    } else {
      prev = (prev * (period - 1) + v) / period;
      adxLine[i] = prev;
    }
  }

  return { adx: adxLine, plusDI, minusDI };
}

/** Williams %R (range -100..0). */
export function williamsR(candles: Candle[], period = 14): Series {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    return range === 0 ? -50 : ((hh - c.close) / range) * -100;
  });
}

/** Commodity Channel Index. */
export function cci(candles: Candle[], period = 20): Series {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const ma = sma(tp, period);
  return candles.map((_, i) => {
    const m = ma[i];
    if (m === null) return null;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - m);
    meanDev /= period;
    return meanDev === 0 ? 0 : (tp[i] - m) / (0.015 * meanDev);
  });
}

/** Williams' Ultimate Oscillator. */
export function ultimateOscillator(candles: Candle[], p1 = 7, p2 = 14, p3 = 28): Series {
  const n = candles.length;
  const bp = new Array<number>(n).fill(0);
  const tr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const pc = candles[i - 1].close;
    bp[i] = candles[i].close - Math.min(candles[i].low, pc);
    tr[i] = Math.max(candles[i].high, pc) - Math.min(candles[i].low, pc);
  }
  const sumBack = (arr: number[], period: number, end: number): number => {
    let s = 0;
    for (let j = end - period + 1; j <= end; j++) if (j >= 0) s += arr[j];
    return s;
  };
  const out: Series = new Array(n).fill(null);
  for (let i = p3; i < n; i++) {
    const t1 = sumBack(tr, p1, i);
    const t2 = sumBack(tr, p2, i);
    const t3 = sumBack(tr, p3, i);
    if (!t1 || !t2 || !t3) {
      out[i] = 50;
      continue;
    }
    const a1 = sumBack(bp, p1, i) / t1;
    const a2 = sumBack(bp, p2, i) / t2;
    const a3 = sumBack(bp, p3, i) / t3;
    out[i] = (100 * (4 * a1 + 2 * a2 + a3)) / 7;
  }
  return out;
}

/** Rate of Change (%). */
export function roc(values: number[], period = 14): Series {
  return values.map((v, i) => {
    if (i < period) return null;
    const prev = values[i - period];
    return prev === 0 ? 0 : ((v - prev) / prev) * 100;
  });
}

/**
 * Investing.com "Highs/Lows(14)" oscillator: distance of the close from the
 * midpoint of the 14-period high/low range. Positive = bullish.
 */
export function highsLows(candles: Candle[], period = 14): Series {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    return c.close - (hh + ll) / 2;
  });
}

/**
 * Elder / investing.com "Bull/Bear Power(13)": bull power (high - EMA13) plus
 * bear power (low - EMA13). The sign tells you which side of the EMA midpoint
 * the market is trading.
 */
export function bullBearPower(candles: Candle[], period = 13): Series {
  const closes = candles.map((c) => c.close);
  const e = ema(closes, period);
  return candles.map((c, i) => {
    const v = e[i];
    return v === null ? null : c.high - v + (c.low - v);
  });
}

/** Latest non-null value of an indicator series. */
export function last(arr: Series | null | undefined): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && v !== undefined && !Number.isNaN(v)) return v;
  }
  return null;
}

/**
 * Resample candles into a larger timeframe by aggregating `factor` consecutive
 * candles (used for Yahoo, which has no 4h interval).
 */
export function aggregate(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor);
    if (!chunk.length) continue;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + (c.volume || 0), 0),
    });
  }
  return out;
}
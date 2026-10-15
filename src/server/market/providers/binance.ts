// Binance public spot klines. No API key, real intraday and daily OHLC.
//
// This is the source for every crypto market on the Analysis page. Binance is
// chosen over the broker for crypto because the broker's crypto lines are thin
// and, for most coins, absent entirely, while Binance lists ~500 liquid pairs
// with years of daily history.
//
// Two shapes of problem, both handled here:
//
//   1. Binance publishes no weekly or monthly klines. Rather than fail those
//      timeframes, they are aggregated from daily bars, which keeps the detail
//      view's all-timeframe strip intact for crypto.
//   2. Volume and price are returned as strings, and timestamps are
//      millisecond open times. Both are normalised to the shared Candle shape.
//
// The public endpoint needs no credentials, so a geo-block shows up as a
// 451/403 here and the orchestrator falls back to the broker.

import { getTimeframe } from "../timeframes";
import type {
  AnalysisSettings,
  Candle,
  FetchContext,
  MarketProvider,
  ProviderWarning,
  SymbolMeta,
  Timeframe,
} from "../types";

const BASE = "https://api.binance.com/api/v3";

/** Binance caps a single klines request at 1000 rows. */
const MAX_LIMIT = 1000;

/** [openTime, open, high, low, close, volume, closeTime, ...] */
type Kline = (number | string)[];

export const id = "binance" as const;

export function supports(meta: SymbolMeta): boolean {
  return Boolean(meta.providers?.binance);
}

async function fetchKlines(pair: string, interval: string, limit: number): Promise<Kline[]> {
  const url = `${BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(
    interval
  )}&limit=${Math.min(limit, MAX_LIMIT)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // A klines request is cheap and quick; never let it outlive the sweep.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Binance HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }
  const data = (await res.json()) as Kline[] | { msg?: string };
  if (!Array.isArray(data)) {
    throw new Error((data as { msg?: string })?.msg || "Unexpected Binance response");
  }
  return data;
}

function toCandles(rows: Kline[]): Candle[] {
  return rows.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]) || 0,
  }));
}

/** Start of the UTC week containing `time`: Monday 00:00. */
function weekStart(time: number): number {
  const d = new Date(time);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * 86_400_000;
}

/** Start of the UTC month containing `time`: the 1st at 00:00. */
function monthStart(time: number): number {
  const d = new Date(time);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/**
 * Fold daily bars into calendar weeks or months.
 *
 * Buckets are calendar based, not a fixed number of days: dividing the epoch by
 * 7 days puts week boundaries on Thursday, and a month is not 30 days. Each
 * bucket keeps the first open, the last close, the extremes, and summed volume.
 */
export function aggregate(candles: Candle[], bucket: "week" | "month"): Candle[] {
  const startOf = bucket === "week" ? weekStart : monthStart;
  const out = new Map<number, Candle>();
  // Fold oldest first: "first open, last close" only means that if the series
  // arrives in order, and Binance has no guarantee it will.
  const ordered = [...candles].sort((a, b) => a.time - b.time);
  for (const c of ordered) {
    const start = startOf(c.time);
    const cur = out.get(start);
    if (!cur) {
      out.set(start, { ...c, time: start });
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  _ctx?: FetchContext,
  warnings?: ProviderWarning[]
): Promise<Candle[]> {
  const pair = meta.providers.binance!;

  // No native interval: build it from daily bars.
  if (tf.aggregate) {
    const source = getTimeframe(tf.aggregate);
    if (!source.binance) throw new Error(`Binance cannot serve ${tf.id}`);
    // Enough daily bars to fill the requested window with headroom.
    if (!tf.bucket) throw new Error(`No aggregation rule for ${tf.id}`);
    const rows = await fetchKlines(pair, source.binance, MAX_LIMIT);
    const daily = toCandles(rows);
    const folded = aggregate(daily, tf.bucket);
    if (folded.length < 30) {
      throw new Error(
        `only ${folded.length} ${tf.id} bars from ${rows.length} ${source.id} bars`
      );
    }
    return folded;
  }

  if (!tf.binance) throw new Error(`Binance does not support ${tf.id}`);
  const rows = await fetchKlines(pair, tf.binance, 500);
  const candles = toCandles(rows);
  if (!candles.length) {
    warnings?.push({ provider: id, message: `Binance returned no ${tf.id} bars for ${pair}` });
  }
  return candles;
}

export const binance: MarketProvider = { id, supports, fetchCandles };
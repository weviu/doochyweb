// Binance public spot API. No API key required, real intraday + daily OHLC.
// Best source for crypto; also serves a gold proxy (PAXGUSDT) for XAUUSD.
// Ported from the standalone `gauge` project.

import { fetchJson } from "./http";
import type { AnalysisSettings, Candle, MarketProvider, SymbolMeta, Timeframe } from "../types";

const BASE = "https://api.binance.com/api/v3";

interface Kline {
  [0]: number | string;
  [1]: number | string;
  [2]: number | string;
  [3]: number | string;
  [4]: number | string;
  [5]: number | string;
}

export const id = "binance" as const;

export function supports(meta: SymbolMeta): boolean {
  return Boolean(meta.providers?.binance);
}

export async function fetchCandles(meta: SymbolMeta, tf: Timeframe): Promise<Candle[]> {
  const symbol = meta.providers.binance!;
  const interval = tf.binance;
  if (!interval) throw new Error(`Binance does not support ${tf.id}`);
  const limit = Math.min(tf.limit || 480, 1000);
  const url = `${BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson<Kline[] | { msg?: string }>(url);
  if (!Array.isArray(data)) {
    throw new Error((data as { msg?: string })?.msg || "Unexpected Binance response");
  }
  return data.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

export const binance: MarketProvider = { id, supports, fetchCandles };
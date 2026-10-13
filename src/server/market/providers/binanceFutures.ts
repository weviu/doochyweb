// Binance USD-M futures (fapi). No API key, and it carries metals that spot
// does not: spot has gold only (PAXG, XAUT), while fapi also lists XAGUSDT
// (silver), XPTUSDT (platinum) and XPDUSD (palladium).
//
// That matters because metals spot feeds are gated on paid data plans: Twelve
// Data returns "available starting with the Grow or Venture plan" for XAG/USD
// on the free tier, Yahoo rate-limits this host, and Stooq is unreachable
// here. Without this provider silver and friends had no real source at all and
// fell through to the simulator.
//
// Candle format and interval names match the spot API.

import { fetchJson } from "./http";
import type { Candle, FetchContext, MarketProvider, SymbolMeta, Timeframe } from "../types";

const BASE = "https://fapi.binance.com/fapi/v1/klines";

type Kline = [number | string, number | string, number | string, number | string, number | string, number | string];

export const id = "binanceFutures" as const;

export function supports(meta: SymbolMeta): boolean {
  return Boolean(meta.providers?.binanceFutures);
}

export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  _ctx?: FetchContext
): Promise<Candle[]> {
  const symbol = meta.providers.binanceFutures!;
  const interval = tf.binance;
  if (!interval) throw new Error(`Binance futures does not support ${tf.id}`);
  const limit = Math.min(tf.limit || 480, 1000);
  const url = `${BASE}?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetchJson<Kline[] | { msg?: string }>(url);
  if (!Array.isArray(data)) {
    throw new Error((data as { msg?: string })?.msg || "Unexpected Binance futures response");
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

export const binanceFutures: MarketProvider = { id, supports, fetchCandles };
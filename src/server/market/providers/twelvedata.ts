// Twelve Data (https://twelvedata.com). One free API key covers forex, metals,
// indices, stocks and crypto. Best single source for everything that is not a
// Binance-listed crypto pair.
//
// The key comes from the TWELVEDATA_API_KEY environment variable only. It is
// never stored in Mongo and never returned over the API, so this module is the
// single place that reads it. Ported from the standalone `gauge` project, which
// allowed the key to be pasted into a settings UI and written to a JSON file.

import { fetchJson } from "./http";
import type { Candle, FetchContext, MarketProvider, SymbolMeta, Timeframe } from "../types";

const BASE = "https://api.twelvedata.com/time_series";

export const id = "twelvedata" as const;

/** Whether a Twelve Data key is configured on this server. */
export function hasTwelveDataKey(): boolean {
  return Boolean(process.env.TWELVEDATA_API_KEY);
}

function apiKey(): string {
  return process.env.TWELVEDATA_API_KEY || "";
}

export function supports(meta: SymbolMeta, _settings?: unknown, _tf?: Timeframe): boolean {
  return Boolean(meta.providers?.twelvedata) && hasTwelveDataKey();
}

interface TwelveValue {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TwelveResponse {
  status?: string;
  message?: string;
  values?: TwelveValue[];
}

export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  _ctx?: FetchContext
): Promise<Candle[]> {
  const symbol = meta.providers.twelvedata!;
  const interval = tf.twelvedata;
  if (!interval) throw new Error(`Twelve Data does not support ${tf.id}`);
  const key = apiKey();
  if (!key) throw new Error("No Twelve Data API key configured");

  const limit = Math.min(tf.limit || 480, 5000);
  const url =
    `${BASE}?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${interval}&outputsize=${limit}` +
    `&apikey=${encodeURIComponent(key)}&order=ASC&timezone=UTC`;

  const data = await fetchJson<TwelveResponse>(url, { timeout: 15000 });
  if (data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(data.message || "Unexpected Twelve Data response");
  }

  return data.values
    .map((v) => ({
      time: parseTime(v.datetime),
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: v.volume ? Number(v.volume) : 0,
    }))
    .filter((c) => Number.isFinite(c.close));
}

function parseTime(datetime?: string): number {
  if (!datetime) return Date.now();
  const iso = datetime.includes(" ") ? datetime.replace(" ", "T") + "Z" : datetime;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Date.parse(datetime);
}

export const twelvedata: MarketProvider = { id, supports, fetchCandles };
// Yahoo Finance chart endpoint. No API key. Great coverage for forex, metals
// (as futures), indices and stocks, but it rate-limits datacenter IPs, so it is
// used as a fallback behind Twelve Data. Ported from `gauge`.

import { aggregate } from "../indicators";
import { fetchJson } from "./http";
import type { Candle, MarketProvider, SymbolMeta, Timeframe } from "../types";

export const id = "yahoo" as const;

export function supports(meta: SymbolMeta): boolean {
  return Boolean(meta.providers?.yahoo);
}

interface YahooResponse {
  chart?: {
    result?: [
      {
        timestamp?: number[];
        indicators?: { quote?: [{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }] };
      }
    ];
    error?: { description?: string };
  };
}

export async function fetchCandles(meta: SymbolMeta, tf: Timeframe): Promise<Candle[]> {
  const symbol = meta.providers.yahoo!;
  let interval = tf.yahoo;
  let range = tf.yahooRange;
  let factor = 1;

  // No native Yahoo interval for this timeframe (4h, 3m): fetch the closest one
  // Yahoo does have and aggregate. The timeframe declares this explicitly so
  // adding an interval is a data change, not a code change here.
  if (!interval && tf.yahooFallback) {
    interval = tf.yahooFallback.interval;
    range = tf.yahooFallback.range;
    factor = tf.yahooFallback.factor;
  }
  if (!interval) throw new Error(`Yahoo does not support ${tf.id}`);

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=false`;

  // Yahoo normally answers in ~150ms; the generous default only ever costs
  // time when the host is unreachable, which the breaker handles after two
  // tries. 8s keeps that first penalty bounded.
  const data = await fetchJson<YahooResponse>(url, { timeout: 8000 });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || "Empty Yahoo response");

  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const candles: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close === null || close === undefined) continue;
    candles.push({
      time: ts[i] * 1000,
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] || 0,
    });
  }
  if (candles.length < 30) throw new Error("Yahoo returned too few candles");
  return factor > 1 ? aggregate(candles, factor) : candles;
}

export const yahoo: MarketProvider = { id, supports, fetchCandles };
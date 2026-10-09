// Deterministic simulator. Used only when every real provider fails, so the
// dashboard always renders. Data is generated from the symbol name, so it is
// stable across refreshes, and is always clearly labelled as simulated.
// Ported from the standalone `gauge` project.

import type { Candle, FetchContext, MarketProvider, SymbolMeta, SymbolType, Timeframe } from "../types";

export const id = "simulated" as const;

export function supports(): boolean {
  return true;
}

const BASE_PRICE: Record<string, number> = {
  XAUUSD: 2350, XAGUSD: 30, XPTUSD: 1010, XPDUSD: 980, XAUEUR: 2150, XAUGBP: 1850,
  US500: 5500, US30: 42000, NAS100: 19800, US2000: 2100, UK100: 8300, GER40: 18500,
  FRA40: 7600, EU50: 5000, JP225: 39000, HK50: 18000, AUS200: 8000, ESP35: 11500,
  ITA40: 34000, DXY: 104.5, VIX: 15,
  BTCUSD: 68000, ETHUSD: 3500, BNBUSD: 580, SOLUSD: 165, XRPUSD: 0.55,
  ADAUSD: 0.45, AVAXUSD: 35, LINKUSD: 15, DOTUSD: 7,
  LTCUSD: 85, BCHUSD: 430, TONUSD: 6.5,
};

const VOLATILITY: Record<SymbolType, number> = {
  forex: 0.004,
  commodity: 0.011,
  index: 0.009,
  crypto: 0.03,
  stock: 0.02,
  unknown: 0.01,
};

export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  _ctx?: FetchContext
): Promise<Candle[]> {
  const limit = Math.min(tf.limit || 480, 800);
  const step = tf.ms;
  const vol = VOLATILITY[meta.type] || VOLATILITY.unknown;
  const price0 = basePrice(meta);

  const rand = mulberry32(hash(meta.symbol) ^ hash(tf.id));
  const out: Candle[] = [];
  let price = price0;
  let trend = (rand() - 0.5) * vol * 0.5;
  const startTime = alignTime(Date.now() - step * (limit - 1), step);

  for (let i = 0; i < limit; i++) {
    // Slowly drifting trend plus noise -> a believable price path.
    if (i % 40 === 0) trend = (rand() - 0.5) * vol * 0.6;
    const noise = ((rand() - 0.5) * 2) * vol;
    const open = price;
    price = Math.max(price * (1 + trend + noise), price0 * 0.05);
    const high = Math.max(open, price) * (1 + rand() * vol * 0.4);
    const low = Math.min(open, price) * (1 - rand() * vol * 0.4);
    out.push({
      time: startTime + i * step,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(price),
      volume: Math.round(1000 + rand() * 9000),
    });
  }
  return out;
}

function basePrice(meta: SymbolMeta): number {
  if (BASE_PRICE[meta.symbol]) return BASE_PRICE[meta.symbol];
  const h = hash(meta.symbol);
  if (meta.type === "forex") {
    const base = 0.7 + (h % 100) / 100; // 0.70 .. 1.69
    const quote = meta.symbol ? meta.symbol.slice(3, 6) : "";
    return quote === "JPY" ? 100 + (h % 60) : Number(base.toFixed(4));
  }
  if (meta.type === "crypto") return 1 + (h % 400);
  if (meta.type === "index") return 2000 + (h % 18000);
  return 20 + (h % 480); // stock
}

function round(v: number): number {
  if (v >= 1000) return Math.round(v * 100) / 100;
  if (v >= 1) return Math.round(v * 10000) / 10000;
  return Math.round(v * 1000000) / 1000000;
}

function alignTime(t: number, step: number): number {
  if (step >= 86400000) return Math.floor(t / 86400000) * 86400000;
  return Math.floor(t / step) * step;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const simulated: MarketProvider = { id, supports, fetchCandles };
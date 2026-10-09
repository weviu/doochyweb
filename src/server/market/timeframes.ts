// Central timeframe definition. Each provider maps an id to its own interval
// string using the fields below, so adding a provider means touching one place.
// Ported unchanged from the standalone `gauge` project.

import type { Timeframe } from "./types";

export const TIMEFRAMES: Timeframe[] = [
  { id: "5m", label: "5 min", ms: 5 * 60 * 1000, ttl: 60, binance: "5m", twelvedata: "5min", yahoo: "5m", yahooRange: "5d" },
  { id: "15m", label: "15 min", ms: 15 * 60 * 1000, ttl: 120, binance: "15m", twelvedata: "15min", yahoo: "15m", yahooRange: "1mo" },
  { id: "30m", label: "30 min", ms: 30 * 60 * 1000, ttl: 180, binance: "30m", twelvedata: "30min", yahoo: "30m", yahooRange: "1mo" },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000, ttl: 300, binance: "1h", twelvedata: "1h", yahoo: "60m", yahooRange: "6mo" },
  { id: "4h", label: "4 hours", ms: 4 * 60 * 60 * 1000, ttl: 600, binance: "4h", twelvedata: "4h", yahoo: null, yahooRange: "1y" },
  { id: "1d", label: "1 day", ms: 24 * 60 * 60 * 1000, ttl: 900, binance: "1d", twelvedata: "1day", yahoo: "1d", yahooRange: "2y" },
  { id: "1w", label: "1 week", ms: 7 * 24 * 60 * 60 * 1000, ttl: 3600, binance: "1w", twelvedata: "1week", yahoo: "1wk", yahooRange: "10y" },
  { id: "1M", label: "1 month", ms: 30 * 24 * 60 * 60 * 1000, ttl: 3600, binance: "1M", twelvedata: "1month", yahoo: "1mo", yahooRange: "10y" },
];

export const DEFAULT_TIMEFRAME = "1d";

export function getTimeframe(id: string): Timeframe {
  return (
    TIMEFRAMES.find((t) => t.id === id) ||
    TIMEFRAMES.find((t) => t.id === DEFAULT_TIMEFRAME)!
  );
}

export function isTimeframeId(id: string): boolean {
  return TIMEFRAMES.some((t) => t.id === id);
}

export function timeframeLabels(): { id: string; label: string }[] {
  return TIMEFRAMES.map(({ id, label }) => ({ id, label }));
}
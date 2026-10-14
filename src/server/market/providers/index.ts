// Bar access for the Analysis page. One source: cTrader.
//
// The read path is three layers, so a page load never waits on the broker:
//
//   memory  - same-process repeat reads and the detail view's all-timeframe sweep
//   Mongo   - survives restarts, so a cold process still renders instantly
//   cTrader - the only network hop, and only when both caches miss or go stale
//
// When Mongo holds a stale series it is returned immediately and refreshed in
// the background, so the page is never blocked waiting for the broker. Only a
// first-ever fetch for a symbol/timeframe blocks, and that is unavoidable.

import { getTimeframe } from "../timeframes";
import * as breaker from "./breaker";
import { readSeries, writeSeries, type StoredBar } from "../persist";
import * as rateLimit from "./rateLimit";
import { ctrader, cTraderCatalog, marketSymbolRef } from "./ctrader";
import type {
  AnalysisSettings,
  Candle,
  CandleResult,
  MarketProvider,
  ProviderId,
  ProviderWarning,
  SymbolMeta,
  Timeframe,
} from "../types";

const REGISTRY: Record<ProviderId, MarketProvider> = { ctrader };

const ORDER: ProviderId[] = ["ctrader"];

/** Bars actually returned before a result is trusted. */
export const MIN_CANDLES = 30;

interface CacheEntry {
  at: number;
  series: Candle[];
}

const cache = new Map<string, CacheEntry>();

// How long to skip cTrader after it says "You are being rate limited". Short,
// because the limit is a pacing window rather than an outage.
const RATE_LIMIT_COOLDOWN_MS = 20_000;

let lastRateLimitAt = 0;

function inRateLimitWindow(now: number): boolean {
  return now - lastRateLimitAt < RATE_LIMIT_COOLDOWN_MS;
}

/** Background refreshes already in flight, so a poll does not stack duplicates. */
const refreshing = new Set<string>();

export interface BarsResult {
  provider: ProviderId;
  bars: Candle[];
  warnings: ProviderWarning[];
  cached: boolean;
  /** True when the broker is updating this series but we served stored bars. */
  stale: boolean;
}

export async function getCandles(
  meta: SymbolMeta,
  timeframeId: string,
  settings: AnalysisSettings = {} as AnalysisSettings,
  { force = false }: { force?: boolean } = {}
): Promise<BarsResult> {
  const tf: Timeframe = getTimeframe(timeframeId);
  const warnings: ProviderWarning[] = [];
  const pid = ORDER[0];
  const key = `${pid}:${meta.symbol}:${tf.id}`;

  // 1. Hot memory cache.
  const hot = cache.get(key);
  if (!force && hot && Date.now() - hot.at < tf.ttl * 1000) {
    breaker.recordSuccess(pid);
    return { provider: pid, bars: hot.series, warnings, cached: true, stale: false };
  }

  const ref = await marketSymbolRef(meta);
  const freshAfter = Date.now() - tf.ttl * 1000;

  // 2. Mongo. A fresh stored series needs no broker call at all; a stale one is
  //    still the best answer available, so return it and refresh behind it.
  if (!force && ref) {
    const stored = await readSeries(ref.ctid, ref.symbolId, tf.id).catch(() => null);
    if (stored && stored.bars.length >= MIN_CANDLES) {
      const fresh = stored.fetchedAt >= freshAfter;
      cache.set(key, { at: stored.fetchedAt, series: stored.bars });
      if (fresh) {
        breaker.recordSuccess(pid);
        return { provider: pid, bars: stored.bars, warnings, cached: true, stale: false };
      }
      void refreshInBackground(pid, meta, tf, key, ref.ctid, ref.symbolId);
      return { provider: pid, bars: stored.bars, warnings, cached: true, stale: true };
    }
  }

  // 3. Broker. Nothing usable stored, so this one has to wait.
  const candles = await fetchFromBroker(pid, meta, tf, warnings);
  cache.set(key, { at: Date.now(), series: candles });
  if (ref) void writeSeries(ref.ctid, ref.symbolId, tf.id, candles).catch(() => {});
  return { provider: pid, bars: candles, warnings, cached: false, stale: false };
}

/** Read the bars behind a resolved symbol, or throw the aggregated reason. */
export function cachedBars(meta: SymbolMeta, timeframeId: string): Candle[] | null {
  const entry = cache.get(`${ORDER[0]}:${meta.symbol}:${timeframeId}`);
  return entry ? entry.series : null;
}

async function fetchFromBroker(
  pid: ProviderId,
  meta: SymbolMeta,
  tf: Timeframe,
  warnings: ProviderWarning[]
): Promise<Candle[]> {
  const p = REGISTRY[pid];
  try {
    const release = await rateLimit.acquire(pid);
    try {
      const candles = await p.fetchCandles(meta, tf, { settings: {} as AnalysisSettings });
      if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
        throw new Error(
          `only ${candles ? candles.length : 0} bars (cTrader may not keep that much history)`
        );
      }
      breaker.recordSuccess(pid);
      return candles;
    } finally {
      release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const rateLimited = /rate limit|BLOCKED_PAYLOAD_TYPE/i.test(message);
    if (rateLimited) lastRateLimitAt = Date.now();
    breaker.recordFailure(pid, rateLimited ? "rate limit" : message);
    warnings.push({ provider: pid, message });
    // A previous run may have left usable bars in memory even when the broker
    // is refusing; stale data beats an empty card.
    const stale = cache.get(`${pid}:${meta.symbol}:${tf.id}`);
    if (stale) return stale.series;
    throw new Error(noSourceError(warnings));
  }
}

async function refreshInBackground(
  pid: ProviderId,
  meta: SymbolMeta,
  tf: Timeframe,
  key: string,
  ctid: number,
  symbolId: number
): Promise<void> {
  if (refreshing.has(key)) return;
  if (inRateLimitWindow(Date.now())) return;
  refreshing.add(key);
  try {
    const release = await rateLimit.acquire(pid);
    let bars: Candle[];
    try {
      bars = await REGISTRY[pid].fetchCandles(meta, tf, { settings: {} as AnalysisSettings });
      if (!Array.isArray(bars) || bars.length < MIN_CANDLES) throw new Error("too few bars");
      breaker.recordSuccess(pid);
    } finally {
      release();
    }
    cache.set(key, { at: Date.now(), series: bars });
    await writeSeries(ctid, symbolId, tf.id, bars as StoredBar[]).catch(() => {});
  } catch {
    // Silent by design: the caller already has usable stored bars.
  } finally {
    refreshing.delete(key);
  }
}

/** The only diagnostic a user gets when bars cannot be read, so it has to be
 *  specific about what failed and why. Exported for testing. */
export function noSourceError(warnings: ProviderWarning[]): string {
  const detail = warnings.map((w) => `${w.provider}: ${w.message}`).join("; ");
  return (
    `Could not read bars from cTrader (${detail}). ` +
    "Check that the account is connected and that the broker lists this symbol."
  );
}

export function clearCache(): void {
  cache.clear();
  breaker.reset();
  rateLimit.reset();
  refreshing.clear();
  lastRateLimitAt = 0;
}

export { ctrader, cTraderCatalog };
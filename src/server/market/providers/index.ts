// Provider orchestrator: walks providers in priority order until one returns
// usable candles, caches the result, and reports which provider was used.
// Ported from the standalone `gauge` project.
//
// The cache is keyed by provider+symbol+timeframe with a per-timeframe TTL, so
// a burst of dashboard refreshes (and the detail view's all-timeframe sweep)
// mostly hit memory instead of burning free-tier API quota.

import { getTimeframe } from "../timeframes";
import * as breaker from "./breaker";
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
import { binance } from "./binance";
import { simulated } from "./simulated";
import { stooq } from "./stooq";
import { twelvedata } from "./twelvedata";
import { yahoo } from "./yahoo";

const REGISTRY: Record<ProviderId, MarketProvider> = {
  binance,
  twelvedata,
  yahoo,
  stooq,
  simulated,
};

const CRYPTO_ORDER: ProviderId[] = ["binance", "twelvedata", "yahoo", "simulated"];
const GENERAL_ORDER: ProviderId[] = ["twelvedata", "yahoo", "stooq", "binance", "simulated"];

const DEFAULT_LIMIT = 480;

/** Bars actually returned by the provider that answered, before aggregation. */
export const MIN_CANDLES = 30;

interface CacheEntry {
  at: number;
  value: CandleResult;
}

const cache = new Map<string, CacheEntry>();

// Symbols are analysed this many at a time. Upstream sources (Binance, Yahoo)
// are the real constraint, not this app; 8 is comfortably inside their burst
// tolerance and cuts sweep latency roughly in half versus 4. Providers that
// are down are skipped outright by the breaker, so the parallelism is spent on
// sources that actually answer.
const SWEEP_CONCURRENCY = 8;

// A single sweep (the detail view's `all=1`) asks for 8 timeframes at once.
// Without a cap that would issue 8 concurrent requests per provider; 4 keeps
// us inside Twelve Data's 8 req/min burst tolerance.
const MAX_SWEEP = 4;

export function providerOrder(meta: SymbolMeta): ProviderId[] {
  return meta.type === "crypto" ? CRYPTO_ORDER : GENERAL_ORDER;
}

/**
 * Fetch candles for a market/timeframe, trying each provider in turn.
 * Throws only when every provider has failed.
 */
export async function getCandles(
  meta: SymbolMeta,
  timeframeId: string,
  settings: AnalysisSettings = {} as AnalysisSettings,
  { force = false }: { force?: boolean } = {}
): Promise<CandleResult & { warnings: ProviderWarning[]; cached: boolean }> {
  const tf: Timeframe = { ...getTimeframe(timeframeId), limit: DEFAULT_LIMIT };

  const warnings: ProviderWarning[] = [];

  // Report a skipped provider as a warning so the UI can still explain why a
  // symbol fell through to a lower-priority source (or the simulator).
  for (const pid of providerOrder(meta)) {
    if (breaker.isAvailable(pid)) continue;
    warnings.push({
      provider: pid,
      message: `temporarily disabled (failing, retry in ${Math.ceil(
        breaker.cooldownRemaining(pid) / 1000
      )}s)`,
    });
  }

  const order = providerOrder(meta).filter((pid) => {
    const p = REGISTRY[pid];
    return p && p.supports(meta, settings, tf) && breaker.isAvailable(pid);
  });

  for (const pid of order) {
    const p = REGISTRY[pid];
    const key = `${pid}:${meta.symbol}:${tf.id}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < tf.ttl * 1000) {
      breaker.recordSuccess(pid);
      return { ...hit.value, warnings, cached: true };
    }
    try {
      const candles: Candle[] = await p.fetchCandles(meta, tf, { settings });
      if (!Array.isArray(candles) || candles.length < MIN_CANDLES) {
        throw new Error(`only ${candles ? candles.length : 0} candles`);
      }
      breaker.recordSuccess(pid);
      const value: CandleResult = {
        candles,
        provider: pid,
        simulated: pid === "simulated",
        proxy: pid === "binance" && meta.proxy ? meta.proxy : undefined,
      };
      cache.set(key, { at: Date.now(), value });
      return { ...value, warnings, cached: false };
    } catch (err) {
      breaker.recordFailure(pid);
      warnings.push({ provider: pid, message: err instanceof Error ? err.message : String(err) });
    }
  }

  throw new Error(
    `No data source available. ${warnings.map((w) => `${w.provider}: ${w.message}`).join("; ")}`
  );
}

export function clearCache(): void {
  cache.clear();
  breaker.reset();
}

export { SWEEP_CONCURRENCY };

/**
 * Run `fn` over `items` with bounded concurrency, preserving input order.
 * Used for per-symbol sweeps so a large watchlist cannot open an unbounded
 * number of upstream requests at once.
 */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export { MAX_SWEEP };
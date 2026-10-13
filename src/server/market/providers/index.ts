// Provider orchestrator: walks providers in priority order until one returns
// usable candles, caches the result, and reports which provider was used.
// Ported from the standalone `gauge` project.
//
// The cache is keyed by provider+symbol+timeframe with a per-timeframe TTL, so
// a burst of dashboard refreshes (and the detail view's all-timeframe sweep)
// mostly hit memory instead of burning free-tier API quota.

import { getTimeframe } from "../timeframes";
import * as breaker from "./breaker";
import * as rateLimit from "./rateLimit";
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
import { binanceFutures } from "./binanceFutures";
import { simulated } from "./simulated";
import { stooq } from "./stooq";
import { twelvedata } from "./twelvedata";
import { yahoo } from "./yahoo";

const REGISTRY: Record<ProviderId, MarketProvider> = {
  binance,
  binanceFutures,
  twelvedata,
  yahoo,
  stooq,
  simulated,
};

const CRYPTO_ORDER: ProviderId[] = ["binance", "binanceFutures", "twelvedata", "yahoo", "simulated"];
// binanceFutures leads because it is free, unlimited and carries metals that the
// other free sources cannot reach. Symbols without a futures mapping skip it
// instantly via supports(), so it costs nothing for forex and equities.
const GENERAL_ORDER: ProviderId[] = ["binanceFutures", "twelvedata", "yahoo", "stooq", "binance", "simulated"];

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
  // symbol fell through to a lower-priority source (or failed outright).
  for (const pid of providerOrder(meta)) {
    if (pid === "simulated" && !settings.allowSimulated) {
      warnings.push({ provider: pid, message: "disabled (simulated data is off)" });
      continue;
    }
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
    if (!p || !p.supports(meta, settings, tf)) return false;
    // The simulator is opt-in. When it is off, a market with no working source
    // fails loudly instead of rendering an invented price.
    if (pid === "simulated" && !settings.allowSimulated) return false;
    return breaker.isAvailable(pid);
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
      // Respect the provider's quota instead of firing a burst and absorbing
      // the resulting 429s.
      await rateLimit.acquire(pid);
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
      const message = err instanceof Error ? err.message : String(err);
      breaker.recordFailure(pid, message);
      warnings.push({ provider: pid, message });
    }
  }

  throw new Error(noSourceError(warnings));
}

/**
 * The only diagnostic a user gets when a market cannot be priced, so it has to
 * name each provider and why it failed, plus the way out. Exported for testing.
 */
export function noSourceError(warnings: ProviderWarning[]): string {
  const detail = warnings.map((w) => `${w.provider}: ${w.message}`).join("; ");
  return (
    `No data source available (${detail}). ` +
    "Set TWELVEDATA_API_KEY on the server to cover forex, metals, indices and stocks, " +
    "or switch simulated data on in Analysis settings."
  );
}

export function clearCache(): void {
  cache.clear();
  breaker.reset();
  rateLimit.reset();
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
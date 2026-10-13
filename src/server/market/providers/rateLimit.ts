import type { ProviderId } from "../types";

// Per-provider request pacing.
//
// Twelve Data's free tier allows 8 credits per minute. A watchlist sweep issues
// one request per symbol per timeframe, so any sweep wider than a handful of
// symbols blew straight through the quota and the API answered 429. Every
// symbol then fell through to its next provider, which for forex and indices
// meant no data at all.
//
// Pacing the requests instead is much better than absorbing 429s: the sweep
// still completes, it just takes as long as the quota allows. This is a token
// bucket per provider, with waiters served in order.

interface Policy {
  /** Burst allowance. */
  capacity: number;
  /** Steady-state refill, per minute. */
  perMinute: number;
}

// null means "no pacing": local or effectively unlimited providers.
const POLICIES: Record<ProviderId, Policy | null> = {
  // Free tier is 8 credits/minute. Not the documented 800/day figure: the
  // per-minute ceiling is what a burst actually hits.
  twelvedata: { capacity: 8, perMinute: 8 },
  binance: { capacity: 60, perMinute: 1200 },
  binanceFutures: { capacity: 60, perMinute: 1200 },
  // Yahoo rate-limits by volume over a window, so keep bursts small.
  yahoo: { capacity: 10, perMinute: 120 },
  stooq: null,
  simulated: null,
};

const REFILL_INTERVAL_MS = 60_000;

interface Bucket {
  tokens: number;
  lastRefill: number;
  queue: (() => void)[];
}

const buckets = new Map<ProviderId, Bucket>();

function bucketFor(provider: ProviderId): Bucket | null {
  const policy = POLICIES[provider];
  if (!policy) return null;
  let b = buckets.get(provider);
  if (!b) {
    b = { tokens: policy.capacity, lastRefill: Date.now(), queue: [] };
    buckets.set(provider, b);
  }
  return b;
}

function refill(b: Bucket, policy: Policy): void {
  const now = Date.now();
  const gained = ((now - b.lastRefill) / REFILL_INTERVAL_MS) * policy.perMinute;
  if (gained <= 0) return;
  b.tokens = Math.min(policy.capacity, b.tokens + gained);
  b.lastRefill = now;
}

/** Take one slot, waiting if the bucket is empty. Resolves immediately when the
 *  provider has no pacing policy. */
export function acquire(provider: ProviderId): Promise<void> {
  const policy = POLICIES[provider];
  const b = bucketFor(provider);
  if (!policy || !b) return Promise.resolve();

  refill(b, policy);
  if (b.tokens >= 1 && b.queue.length === 0) {
    b.tokens -= 1;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    b!.queue.push(resolve);
    const msPerToken = REFILL_INTERVAL_MS / policy.perMinute;
    const waitFor = msPerToken * Math.max(1, b!.queue.length);
    setTimeout(() => {
      refill(b!, policy);
      const next = b!.queue.shift();
      if (next) {
        b!.tokens = Math.max(0, b!.tokens - 1);
        next();
      }
    }, waitFor);
  });
}

/** Drop all pacing state. Used by clearCache() and the tests. */
export function reset(): void {
  for (const b of buckets.values()) {
    for (const resolve of b.queue) resolve();
    b.queue = [];
  }
  buckets.clear();
}
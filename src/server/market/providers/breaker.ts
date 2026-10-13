import type { ProviderId } from "../types";

// Per-provider circuit breaker.
//
// The provider chain falls through in order, so a provider that is down costs
// its full timeout on every single symbol, every refresh. On this host that was
// 10.5s per symbol for Stooq (DNS/network blocked), which dominated page load.
//
// After a couple of consecutive failures a provider is skipped entirely for a
// cooldown that grows while it stays broken and resets the moment it answers
// again. A success from any symbol clears the counter, so a provider that is
// merely busy (Yahoo's 429s) trips and recovers quickly.

interface BreakerState {
  failures: number;
  openUntil: number;
  // How many times this provider has been taken out of rotation since it last
  // answered. A sweep analyses many symbols at once, so a provider that is down
  // fails several times per trip; only a *new* trip (a closed breaker opening
  // again) should lengthen the cooldown, otherwise one bad sweep pins it at the
  // maximum for half an hour.
  trips: number;
}

const state = new Map<ProviderId, BreakerState>();

/** Consecutive failures before a provider is taken out of rotation. */
const FAILURE_THRESHOLD = 2;

/** Cooldown after the first trip; doubles per subsequent trip, capped. */
const BASE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * A rate limit is not a dead provider. Twelve Data hands back 429 "you have run
 * out of API credits for the current minute" and its quota refills every 60
 * seconds, so parking it for 5+ minutes threw away most of its availability.
 * Rate-limited providers get a short cooldown that simply matches the refill
 * window instead.
 */
const RATE_LIMIT_COOLDOWN_MS = 65 * 1000;
const RATE_LIMIT_PATTERN = /\b(429|too many requests|rate limit|out of API credits|quota)\b/i;

function entry(provider: ProviderId): BreakerState {
  let s = state.get(provider);
  if (!s) {
    s = { failures: 0, openUntil: 0, trips: 0 };
    state.set(provider, s);
  }
  return s;
}

/** Whether this provider may be attempted right now. */
export function isAvailable(provider: ProviderId, now = Date.now()): boolean {
  return entry(provider).openUntil <= now;
}

/** How long this provider stays skipped, in ms (0 when available). */
export function cooldownRemaining(provider: ProviderId, now = Date.now()): number {
  return Math.max(0, entry(provider).openUntil - now);
}

export function recordSuccess(provider: ProviderId): void {
  state.set(provider, { failures: 0, openUntil: 0, trips: 0 });
}

export function recordFailure(provider: ProviderId, message = "", now = Date.now()): void {
  const s = entry(provider);
  // Already out of rotation: this failure is part of the same outage, so leave
  // the cooldown where it is rather than escalating on every symbol.
  if (s.openUntil > now) return;
  s.failures++;

  // Rate limited: one short cooldown, then straight back in. No escalation,
  // because the quota window resets regardless of how many symbols hit it.
  if (RATE_LIMIT_PATTERN.test(message)) {
    s.openUntil = now + RATE_LIMIT_COOLDOWN_MS;
    return;
  }

  if (s.failures < FAILURE_THRESHOLD) return;
  s.trips++;
  s.openUntil = now + Math.min(BASE_COOLDOWN_MS * 2 ** (s.trips - 1), MAX_COOLDOWN_MS);
}

/** Drop all breaker state (also used by the settings reset path). */
export function reset(): void {
  state.clear();
}

/** Test/debug snapshot. */
export function snapshot(): Record<string, { failures: number; trips: number; coolingMs: number }> {
  const now = Date.now();
  return Object.fromEntries(
    [...state.entries()].map(([id, s]) => [
      id,
      { failures: s.failures, trips: s.trips, coolingMs: cooldownRemaining(id, now) },
    ])
  );
}

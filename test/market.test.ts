// Assertions for the Analysis engine (indicator math, rating rules, symbol
// resolution and the simulator). Ported from the standalone `gauge` project's
// hand-rolled runner onto node:test.
//
// Run with: pnpm test

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { analyze, RATINGS } from "../src/server/market/analysis";
import * as ti from "../src/server/market/indicators";
import { resolveSymbol } from "../src/server/market/symbols";
import { fetchCandles as simulatedCandles } from "../src/server/market/providers/simulated";
import * as breaker from "../src/server/market/providers/breaker";
import type { Candle, Timeframe } from "../src/server/market/types";

// Deterministic OHLC series: a slow sine drift around price 100, so every
// indicator has something non-degenerate to chew on.
function makeCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    price += Math.sin(i / 5) * 1.5 + Math.cos(i / 11) * 0.8 + 0.1;
    const high = Math.max(open, price) + Math.abs(Math.sin(i)) * 0.6;
    const low = Math.min(open, price) - Math.abs(Math.cos(i)) * 0.6;
    out.push({ time: i * 86400000, open, high, low, close: price, volume: 1000 });
  }
  return out;
}

describe("moving averages", () => {
  test("sma computes trailing average", () => {
    const out = ti.sma([1, 2, 3, 4, 5], 3);
    assert.equal(out[4], 4);
    assert.equal(out[3], 3);
    assert.equal(out[0], null);
  });

  test("ema seeds with sma then smooths", () => {
    const out = ti.ema([1, 2, 3, 4, 5], 3);
    assert.equal(out[2], 2);
    assert.equal(Math.round((out[4] as number) * 1000) / 1000, 4);
  });

  test("aggregate resamples candles", () => {
    const candles = makeCandles(8);
    const agg = ti.aggregate(candles, 4);
    assert.equal(agg.length, 2);
    assert.equal(agg[0].open, candles[0].open);
    assert.equal(agg[0].close, candles[3].close);
  });
});

describe("oscillators", () => {
  test("rsi stays within 0..100", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    for (const v of ti.rsi(values, 14).filter((x) => x !== null)) {
      assert.ok(v >= 0 && v <= 100, `rsi out of range: ${v}`);
    }
  });

  test("rsi is 100 for a strictly rising series", () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    assert.equal(ti.last(ti.rsi(values, 14)), 100);
  });

  test("macd/atr/adx produce finite latest values", () => {
    const candles = makeCandles(300);
    assert.ok(Number.isFinite(ti.last(ti.macd(candles.map((c) => c.close)).macd)));
    assert.ok(Number.isFinite(ti.last(ti.atr(candles, 14))));
    assert.ok(Number.isFinite(ti.last(ti.adx(candles, 14).adx)));
  });

  test("remaining oscillators are defined", () => {
    const candles = makeCandles(300);
    const closes = candles.map((c) => c.close);
    assert.ok(Number.isFinite(ti.last(ti.stochastic(candles).k)));
    assert.ok(Number.isFinite(ti.last(ti.stochRsi(closes).k)));
    assert.ok(Number.isFinite(ti.last(ti.cci(candles, 20))));
    assert.ok(Number.isFinite(ti.last(ti.ultimateOscillator(candles))));
    assert.ok(Number.isFinite(ti.last(ti.roc(closes, 14))));
    assert.ok(Number.isFinite(ti.last(ti.highsLows(candles, 14))));
    assert.ok(Number.isFinite(ti.last(ti.bullBearPower(candles, 13))));
  });

  test("roc math is correct", () => {
    assert.equal(ti.last(ti.roc([1, 2, 4], 2)), 300);
  });

  test("williams %R within -100..0", () => {
    for (const v of ti.williamsR(makeCandles(120), 14)) {
      if (v !== null) assert.ok(v >= -100 && v <= 0, `wr out of range: ${v}`);
    }
  });
});

describe("analysis", () => {
  test("returns 12 oscillators + 12 MAs and a valid rating", () => {
    const result = analyze(makeCandles(320), { symbol: "TEST", name: "Test", type: "crypto" }, "1d");
    assert.equal(result.oscillators.rows.length, 12);
    assert.equal(result.movingAverages.rows.length, 12);
    assert.ok(RATINGS.includes(result.summary.rating), `bad rating ${result.summary.rating}`);
    assert.ok(result.summary.score >= -1 && result.summary.score <= 1);
    assert.equal(result.summary.buy + result.summary.sell + result.summary.neutral, 24);
  });

  test("rejects too little data", () => {
    assert.throws(() => analyze(makeCandles(10), { symbol: "X" }, "1d"));
  });
});

describe("symbols", () => {
  test("resolves forex, metals, crypto, index and stock", () => {
    assert.equal(resolveSymbol("EUR/USD").type, "forex");
    assert.equal(resolveSymbol("eurusd").providers.twelvedata, "EUR/USD");
    assert.equal(resolveSymbol("XAUUSD").type, "commodity");
    assert.equal(resolveSymbol("XAUUSD").providers.binance, "PAXGUSDT");
    assert.equal(resolveSymbol("BTC/USDT").symbol, "BTCUSD");
    assert.equal(resolveSymbol("btcusdt").providers.binance, "BTCUSDT");
    assert.equal(resolveSymbol("US500").type, "index");
    assert.equal(resolveSymbol("AAPL").type, "stock");
  });
});

describe("provider circuit breaker", () => {
  // The breaker is what keeps a dead provider from billing its timeout to every
  // symbol on every sweep, so its trip/cooldown arithmetic is worth pinning.
  const FIVE_MIN = 5 * 60 * 1000;

  test("stays closed until the failure threshold is reached", () => {
    breaker.reset();
    const now = 1_000_000;
    breaker.recordFailure("stooq", now);
    assert.equal(breaker.isAvailable("stooq", now), true);
    assert.equal(breaker.cooldownRemaining("stooq", now), 0);
  });

  test("opens after the threshold and blocks calls", () => {
    breaker.reset();
    const now = 1_000_000;
    breaker.recordFailure("stooq", now);
    breaker.recordFailure("stooq", now);
    assert.equal(breaker.isAvailable("stooq", now), false);
    assert.equal(breaker.cooldownRemaining("stooq", now), FIVE_MIN);
  });

  test("more failures in the same outage do not lengthen the cooldown", () => {
    breaker.reset();
    const now = 1_000_000;
    for (let i = 0; i < 20; i++) breaker.recordFailure("yahoo", now);
    // One sweep analyses many symbols; all those failures are one incident.
    assert.equal(breaker.cooldownRemaining("yahoo", now), FIVE_MIN);
  });

  test("cooldown doubles per later trip and is capped", () => {
    breaker.reset();
    let now = 1_000_000;
    const trip = (at: number) => {
      breaker.recordFailure("stooq", at);
      breaker.recordFailure("stooq", at);
    };
    trip(now);
    assert.equal(breaker.cooldownRemaining("stooq", now), FIVE_MIN);
    // Cooldown expires, the probe fails again, so the next trip is longer.
    now += FIVE_MIN;
    trip(now);
    assert.equal(breaker.cooldownRemaining("stooq", now), FIVE_MIN * 2);
    now += FIVE_MIN * 2;
    trip(now);
    assert.equal(breaker.cooldownRemaining("stooq", now), FIVE_MIN * 4);
  });

  test("a success closes it and resets the escalation", () => {
    breaker.reset();
    const now = 1_000_000;
    breaker.recordFailure("yahoo", now);
    breaker.recordFailure("yahoo", now);
    assert.equal(breaker.isAvailable("yahoo", now), false);
    breaker.recordSuccess("yahoo");
    assert.equal(breaker.isAvailable("yahoo", now), true);
    assert.equal(breaker.snapshot().yahoo.trips, 0);
  });

  test("a provider that keeps working is never blocked", () => {
    breaker.reset();
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) {
      breaker.recordSuccess("binance");
      assert.equal(breaker.isAvailable("binance", now), true);
    }
  });
});

describe("providers", () => {
  test("simulated provider produces a valid, analysable series", async () => {
    const tf = { id: "1d", ms: 86400000, limit: 320 } as Timeframe;
    const meta = resolveSymbol("XAUUSD");
    const candles = await simulatedCandles(meta, tf);
    assert.equal(candles.length, 320);
    const result = analyze(candles, meta, "1d");
    assert.ok(result.price > 0);
    assert.ok(RATINGS.includes(result.summary.rating));
  });
});
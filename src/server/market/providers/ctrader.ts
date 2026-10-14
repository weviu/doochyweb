// cTrader OHLC bars, read with ProtoOAGetTrendbarsReq.
//
// This is the only data source for the Analysis page. It is a good fit: the
// broker's own prices for exactly the instruments this deployment trades
// (metals, FX majors, BTC/ETH, and the cash indices that no free public API
// covers), with no third-party key and no third-party quota.
//
// Two protocol details the payload makes non-obvious:
//
//  - A bar is stored as `low` plus unsigned deltas: open = low + deltaOpen,
//    close = low + deltaClose, high = low + deltaHigh. The integers are in
//    1/100000 of a price unit (the same fixed point the proto states for
//    relativeStopLoss/relativeTakeProfit), NOT in the symbol's `digits`.
//    Verified across metals, FX, crypto and index CFDs whose `digits` range
//    from 2 to 5: every one of them only lands on a sane price at 1e5
//    (XAUUSD 416113000 -> 4161.13, BTCUSD 8337033000 -> 83370.33).
//  - The bar timestamp is in MINUTES since the epoch, not milliseconds.
//
// The request is capped by the proto per period (see timeframes.ts), and
// cTrader answers BLOCKED_PAYLOAD_TYPE / "You are being rate limited" when bars
// are pulled back to back, so callers must go through the shared pacer.

import { userSockets, type CtraderEnv } from "../../ctrader/connection";

import { listTradableNames, resolveTradableSymbol } from "../../ctrader/reads";
import { resolveMarketAccount } from "../account";
import type {
  AnalysisSettings,
  Candle,
  FetchContext,
  MarketProvider,
  SymbolMeta,
  Timeframe,
} from "../types";

/** Bar prices are integers in 1/100000 of a price unit. */
const PRICE_SCALE = 100_000;

export const id = "ctrader" as const;

/** Bars to request. 480 covers a 200-period MA with room for warm-up. */
const WANT_BARS = 480;

export function supports(meta: SymbolMeta): boolean {
  return Boolean(meta.providers?.ctrader);
}

/** Storage identity for a series: which account, which broker symbol. Resolved
 *  through the reads-layer caches, so repeat calls are effectively free. */
export async function marketSymbolRef(
  meta: SymbolMeta
): Promise<{ ctid: number; symbolId: number } | null> {
  const name = meta.providers?.ctrader;
  if (!name) return null;
  try {
    const account = await resolveMarketAccount();
    const env: CtraderEnv = account.isLive ? "live" : "demo";
    const resolved = await resolveTradableSymbol(account.userId, env, account.ctid, name);
    return resolved ? { ctid: account.ctid, symbolId: resolved.symbolId } : null;
  } catch {
    return null;
  }
}

interface RawTrendbar {
  low?: number | string;
  deltaOpen?: number | string;
  deltaClose?: number | string;
  deltaHigh?: number | string;
  utcTimestampInMinutes?: number | string;
  volume?: number | string;
}

export async function fetchCandles(
  meta: SymbolMeta,
  tf: Timeframe,
  _ctx?: FetchContext
): Promise<Candle[]> {
  const period = tf.ctrader;
  if (period == null) throw new Error(`cTrader has no bar size for ${tf.id}`);

  const account = await resolveMarketAccount();
  const env: CtraderEnv = account.isLive ? "live" : "demo";

  const resolved = await resolveTradableSymbol(account.userId, env, account.ctid, meta.providers.ctrader!);
  if (!resolved) {
    throw new Error(`${meta.providers.ctrader} is not tradable on this cTrader account`);
  }

  // Ask for the bars we need, but never exceed the range the proto allows for
  // this period or it rejects the whole request.
  const wanted = WANT_BARS * tf.ms;
  const span = Math.min(wanted, tf.ctraderMaxRange);
  const to = Date.now();
  const from = to - span;

  const res = await userSockets(account.userId).send(
    env,
    "ProtoOAGetTrendbarsReq",
    {
      ctidTraderAccountId: account.ctid,
      symbolId: resolved.symbolId,
      period,
      fromTimestamp: from,
      toTimestamp: to,
      count: WANT_BARS,
    },
    // Read-only consumer: never rotate the grant. See connection.ts.
    { ctid: account.ctid, rotateOnTokenError: false }
  );

  const bars = (res?.trendbar ?? []) as RawTrendbar[];
  if (!bars.length) {
    throw new Error(
      `cTrader returned no ${tf.id} bars for ${meta.providers.ctrader} (broker history may not reach that far back)`
    );
  }

  const candles: Candle[] = bars.map((b) => {
    const low = Number(b.low ?? 0);
    return {
      time: Number(b.utcTimestampInMinutes ?? 0) * 60_000,
      open: (low + Number(b.deltaOpen ?? 0)) / PRICE_SCALE,
      high: (low + Number(b.deltaHigh ?? 0)) / PRICE_SCALE,
      low: low / PRICE_SCALE,
      close: (low + Number(b.deltaClose ?? 0)) / PRICE_SCALE,
      volume: Number(b.volume ?? 0),
    };
  });

  // The API returns oldest-first, but sort defensively so downstream indicator
  // alignment can rely on chronological order.
  candles.sort((a, b) => a.time - b.time);
  return candles;
}

/** Broker symbol names available for analysis on the configured account. */
export async function cTraderCatalog(): Promise<string[]> {
  const account = await resolveMarketAccount();
  const env: CtraderEnv = account.isLive ? "live" : "demo";
  const names = await listTradableNames(account.userId, env, account.ctid);
  return names;
}

export const ctrader: MarketProvider = { id, supports, fetchCandles };
// The crypto half of the add-market catalog, derived from Binance.
//
// Binance's exchangeInfo is the authoritative list of crypto markets, but it is
// a 17MB document covering 1400+ pairs across every quote asset, so it is
// downloaded once, reduced to a few hundred entries here, and cached both in
// memory and in Mongo. Nothing on the request path re-downloads it.
//
// Three reductions make the list usable as a catalog:
//
//   1. One entry per asset. Every coin is listed against dozens of quotes
//      (SOLUSDT, SOLBRL, SOLJPY, SOLUSD ...), which would fill the picker with
//      the same asset ten times. USDT is preferred, then USD, and the rest are
//      dropped. This is what removes SOLUSD in favour of the SOLUSDT pair.
//   2. Junk bases are dropped: single letters, very long token names, non-ASCII
//      names, and USD stablecoins, which would render as USDCUSD and friends.
//   3. Fiat bases are dropped. Binance lists EURUSDT, which would render as
//      EURUSD and collide with the real FX pair that cTrader serves properly.

import mongoose from "mongoose";
import type { CatalogEntry } from "./types";

const EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo";

/** Quotes worth offering. Everything else is a local-fiat or cross pair. */
const WANTED_QUOTES = ["USDT", "USD"] as const;

/** Fiat codes. Excluded so their rendered names cannot collide with FX pairs. */
const FIAT = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "TRY", "ZAR",
  "MXN", "BRL", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "RON", "ARS",
  "IDR", "JOD", "NGN",
]);

/** Shown in the picker as "<base>USD" regardless of the quote actually used. */
export interface CryptoPair {
  /** What the UI and the watchlist call it, e.g. "SOLUSD". */
  symbol: string;
  /** The Binance pair that is actually fetched, e.g. "SOLUSDT". */
  pair: string;
  /** The underlying asset, e.g. "SOL". Used to spot the same asset under a
   *  different name, which is how a broker "BTCUSDT" line is recognised as a
   *  duplicate of Binance's "BTCUSD". */
  base: string;
}

export interface RawPair {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

/** Reject token names that are not a clean ticker. */
function usableBase(base: string): boolean {
  if (base.length < 2 || base.length > 10) return false;
  if (!/^[A-Z0-9]+$/.test(base)) return false;
  // USD stablecoins (USDC, FDUSD, TUSD, RLUSD, USD1 ...) would render as
  // USDCUSD, which is not a market anyone wants to chart.
  if (base.includes("USD")) return false;
  if (FIAT.has(base)) return false;
  return true;
}

/**
 * Reduce Binance's full pair list to one crypto market per asset.
 *
 * Exported for testing: this is where the ordering and filtering rules live, and
 * they are the part that is easy to get subtly wrong.
 */
export function deriveCryptoPairs(raw: RawPair[]): CryptoPair[] {
  const byBase = new Map<string, string>();
  for (const quote of WANTED_QUOTES) {
    for (const r of raw) {
      if (r.status !== "TRADING") continue;
      if (r.quoteAsset !== quote) continue;
      if (!usableBase(r.baseAsset)) continue;
      // First writer wins, and USDT is visited first.
      if (!byBase.has(r.baseAsset)) byBase.set(r.baseAsset, r.symbol);
    }
  }
  return [...byBase.entries()]
    .map(([base, pair]) => ({ symbol: `${base}USD`, pair, base }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Quote suffixes a broker may use for the same asset Binance quotes in USDT.
 * The broker carries crypto crosses and fiat quotes the Binance spot list does
 * not (BTCEUR, SOLVUSD), and those are the same asset, so they collapse into the
 * one USDT entry rather than appearing twice.
 */
const QUOTE_SUFFIXES = [
  "USDT", "USDS", "USDC", "BUSD", "TUSD", "FDUSD", "USD",
  "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "TRY", "ZAR",
  "MXN", "BRL", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "RON",
  "ARS", "IDR", "BTC", "ETH",
];

/**
 * Strip a trailing quote from a ticker, returning the underlying asset.
 *
 * "BTCUSDT" and "BTCUSD" both reduce to "BTC", which is what lets the catalog
 * drop the broker's USDT line when Binance already covers the asset.
 */
export function baseAssetOf(ticker: string): string {
  for (const quote of QUOTE_SUFFIXES) {
    if (ticker.length > quote.length && ticker.endsWith(quote)) {
      return ticker.slice(0, -quote.length);
    }
  }
  return ticker;
}

/** The same list in the shape the catalog endpoint serves. */
export function cryptoCatalogEntries(pairs: CryptoPair[]): CatalogEntry[] {
  return pairs.map((p) => ({
    symbol: p.symbol,
    // The Binance pair is the display name, so the picker shows which market
    // backs the entry and the resolver can read it straight back.
    name: p.pair,
    type: "crypto" as const,
    provider: "binance" as const,
  }));
}

// --------------------------------------------------------------- caching

const MEM_TTL_MS = 12 * 60 * 60 * 1000;

const schema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    pairs: { type: [{ symbol: String, pair: String }], default: [] },
    fetchedAt: { type: Date, required: true },
  },
  { versionKey: false }
);

type Doc = { _id: string; pairs: CryptoPair[]; fetchedAt: Date };

const Model =
  (mongoose.models.BinancePairs as mongoose.Model<Doc> | undefined) ||
  mongoose.model<Doc>("BinancePairs", schema);

let mem: { at: number; pairs: CryptoPair[] } | null = null;

async function download(): Promise<CryptoPair[]> {
  const res = await fetch(EXCHANGE_INFO, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Binance exchangeInfo HTTP ${res.status}`);
  const body = (await res.json()) as { symbols?: RawPair[] };
  const pairs = deriveCryptoPairs(body.symbols || []);
  if (!pairs.length) throw new Error("Binance exchangeInfo returned no usable pairs");
  return pairs;
}

/**
 * The crypto catalog, from memory, then Mongo, then Binance.
 *
 * Never throws: a catalog read must not be able to fail the Analysis page, so a
 * network failure returns whatever was last stored (or an empty list).
 */
export async function cryptoPairs(): Promise<CryptoPair[]> {
  if (mem && Date.now() - mem.at < MEM_TTL_MS) return mem.pairs;

  try {
    const doc = await Model.findById("binance").lean().exec();
    if (doc && doc.pairs?.length && Date.now() - new Date(doc.fetchedAt).getTime() < MEM_TTL_MS) {
      mem = { at: Date.now(), pairs: doc.pairs };
      return mem.pairs;
    }
  } catch {
    // Mongo is optional here; fall through to the network.
  }

  try {
    const pairs = await download();
    mem = { at: Date.now(), pairs };
    void Model.updateOne(
      { _id: "binance" },
      { $set: { pairs, fetchedAt: new Date() } },
      { upsert: true }
    )
      .exec()
      .catch(() => {});
    return pairs;
  } catch {
    // Serve whatever we last saw rather than failing the page.
    if (mem) return mem.pairs;
    try {
      const doc = await Model.findById("binance").lean().exec();
      if (doc?.pairs?.length) {
        mem = { at: Date.now(), pairs: doc.pairs };
        return mem.pairs;
      }
    } catch {
      // ignore
    }
    return [];
  }
}

/** Force the next read to hit Binance again. */
export function resetCryptoCache(): void {
  mem = null;
}
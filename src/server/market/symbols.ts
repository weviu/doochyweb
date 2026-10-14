// Market symbol resolution against the broker's own symbol list.
//
// There is no hand-maintained catalog any more: what can be analysed is exactly
// what the configured cTrader account can trade. This module maps the familiar
// short name people type (and that the watchlist already holds) onto the broker's
// exact symbol string, because the two rarely match for anything other than
// majors:
//
//   EURUSD, XAUUSD, XAGUSD, XPTUSD, XPDUSD, BTCUSD, ETHUSD   exact
//   US500  -> "US 500"        NAS100 -> "US TECH 100"
//   GER40  -> "GERMANY 40"    ITA40  -> "ITALY 40"
//
// Resolution order: alias table, then an exact match, then a
// punctuation-insensitive match. Anything else is reported as untradable rather
// than guessed at.

import type { CatalogEntry, SymbolMeta, SymbolType } from "./types";

// Familiar name -> broker symbol name. Keys are the short forms used by the
// watchlist and the add-market box.
const ALIASES: Record<string, string> = {
  // Indices (investing.com style -> broker wording)
  US500: "US 500",
  US30: "US 30",
  NAS100: "US TECH 100",
  UK100: "UK 100",
  GER40: "GERMANY 40",
  FRA40: "FRANCE 40",
  ITA40: "ITALY 40",
  AUS200: "AUSTRALIA 200",
  JP225: "JAPAN 225",
  ESP35: "SPAIN 35",
  DXY: "DB US DOLLAR INDEX",
  VIX: "S&P 500 LOW VOLATILITY",
  // Alternate index spellings people tend to type.
  SPX: "US 500",
  NDX: "US TECH 100",
  DE40: "GERMANY 40",
  CAC40: "FRANCE 40",
  FTMIB: "ITALY 40",
  ASX: "AUSTRALIA 200",
  N225: "JAPAN 225",
  IBEX: "SPAIN 35",
  // Crypto the broker lists as USDT pairs.
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
};

// Asset class, inferred from the broker name. Drives the type badge in the UI.
function inferType(brokerName: string): SymbolType {
  const raw = brokerName.toUpperCase();
  const n = raw.replace(/\s+/g, "");
  if (/^(BTC|ETH)(USD|USDT)$/.test(n)) return "crypto";
  // Metal bases must be checked BEFORE the FX-pair rule: XAUUSD is a six-letter
  // pair ending in USD, so a quote-currency check first would file gold as forex.
  if (/^X(AU|AG|PT|PD)$/.test(n.slice(0, 3))) return "commodity";
  if (/^(GOLD|SILVER|PLATINUM|PALLADIUM)/.test(n)) return "commodity";
  // Six letters, all currency codes: FX pair.
  if (/^[A-Z]{6}$/.test(n)) {
    if (["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD"].includes(n.slice(3, 6))) {
      return "forex";
    }
    return "crypto";
  }
  // Index check runs against the SPACED name: "US 500" needs the word boundary
  // that stripping the space would destroy.
  if (/\b(500|30|100|200|225|35|40)\b/.test(raw)) return "index";
  if (/DOLLAR INDEX|VOLATILITY/.test(raw)) return "index";
  return "stock";
}

/** Uppercase, strip anything that is not a letter or digit. */
export function normalizeSymbol(input: unknown): string {
  return String(input || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Resolve a user-typed symbol to the broker's exact name, given the set the
 * account offers. Returns null when the broker cannot trade it.
 */
export function resolveAgainstBroker(input: unknown, available: string[]): string | null {
  const cleaned = normalizeSymbol(input);
  if (!cleaned) return null;

  const byPunctInsensitive = new Map<string, string>();
  const byWordy = new Map<string, string>();
  for (const name of available) {
    const flat = normalizeSymbol(name);
    if (flat && !byPunctInsensitive.has(flat)) byPunctInsensitive.set(flat, name);
    const wordy = name.toUpperCase().replace(/\s+/g, " ");
    if (wordy && !byWordy.has(wordy)) byWordy.set(wordy, name);
  }

  const alias = ALIASES[cleaned];
  if (alias) {
    // The alias is only trusted if this broker actually lists it.
    if (available.includes(alias)) return alias;
    const viaFlat = byPunctInsensitive.get(normalizeSymbol(alias));
    if (viaFlat) return viaFlat;
  }

  if (available.includes(cleaned)) return cleaned;
  const flat = byPunctInsensitive.get(cleaned);
  if (flat) return flat;

  // Last resort: a single unambiguous word match ("Gold", "Silver 5").
  const words = String(input).toUpperCase().trim().split(/\s+/);
  if (words.length >= 2) {
    const phrase = words.join(" ");
    if (byWordy.has(phrase)) return byWordy.get(phrase)!;
  }
  return null;
}

/** Build the meta the analysis engine expects, from a resolved broker name. */
export function toSymbolMeta(brokerName: string, requested?: string): SymbolMeta {
  return {
    symbol: requested && requested !== brokerName ? requested : brokerName,
    name: brokerName,
    type: inferType(brokerName),
    providers: { ctrader: brokerName },
    note: requested && requested !== brokerName ? `cTrader symbol: ${brokerName}` : undefined,
  };
}

/**
 * The add-market catalog: every symbol the account can trade, plus an entry for
 * each alias that this account can actually serve (so US500 appears even though
 * the broker calls it "US 500").
 */
export function buildCatalog(available: string[]): CatalogEntry[] {
  const out = new Map<string, CatalogEntry>();
  for (const name of available) {
    const short = normalizeSymbol(name);
    if (!short) continue;
    out.set(short, { symbol: short, name, type: inferType(name) });
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (out.has(alias) || !available.includes(target)) continue;
    out.set(alias, { symbol: alias, name: target, type: inferType(target) });
  }
  return [...out.values()];
}

/** Substring search over the catalog, for the add-market autocomplete. */
export function searchCatalog(
  entries: CatalogEntry[],
  query: unknown,
  limit = 12
): CatalogEntry[] {
  const q = normalizeSymbol(query);
  if (!q) return entries.slice(0, limit);
  const results: CatalogEntry[] = [];
  for (const e of entries) {
    if (normalizeSymbol(e.symbol).includes(q) || e.name.toUpperCase().replace(/\s+/g, "").includes(q)) {
      results.push(e);
      if (results.length >= limit) break;
    }
  }
  return results;
}
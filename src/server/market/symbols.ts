// Instrument catalog + symbol resolution.
//
// A "meta" object is the canonical description of a market:
//   { symbol, name, type, providers: { binance?, twelvedata?, yahoo?, stooq? },
//     note?, proxy? }
//
// Providers are best-effort: the orchestrator walks them in priority order and
// uses the first that returns candles. Ported from the standalone `gauge`
// project; only types were added.

import type { CatalogEntry, SymbolMeta, SymbolType } from "./types";

export const FIAT = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNH", "CNY", "SEK",
  "NOK", "DKK", "PLN", "HUF", "CZK", "TRY", "ZAR", "MXN", "SGD", "HKD", "INR",
  "RUB", "BRL", "THB", "KRW", "ILS", "RON",
]);

export const METALS = new Set(["XAU", "XAG", "XPT", "XPD"]);

// Metals that Yahoo can serve (as futures), used when there is no key.
const YAHOO_METAL: Record<string, string | null> = {
  XAU: "GC=F",
  XAG: "SI=F",
  XPT: "PL=F",
  XPD: "PA=F",
};

// Metals on Binance USD-M futures. Spot has gold only, but fapi also lists
// silver, platinum and palladium, and every free alternative is either
// rate-limited (Yahoo from this host) or a paid data plan (Twelve Data's
// XAG/USD is Grow/Venture tier). So the futures perimeter is the one source
// that prices these without a key.
const BINANCE_FUTURES: Record<string, string> = {
  XAU: "XAUUSDT",
  XAG: "XAGUSDT",
  XPT: "XPTUSDT",
  XPD: "XPDUSDT",
};

// Base asset -> Binance spot symbol. Only real, liquid pairs.
const BINANCE: Record<string, string> = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", BNB: "BNBUSDT", SOL: "SOLUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", AVAX: "AVAXUSDT",
  DOT: "DOTUSDT", LINK: "LINKUSDT", LTC: "LTCUSDT", BCH: "BCHUSDT",
  XLM: "XLMUSDT", TRX: "TRXUSDT", TON: "TONUSDT", SHIB: "SHIBUSDT",
  ATOM: "ATOMUSDT", UNI: "UNIUSDT", NEAR: "NEARUSDT", APT: "APTUSDT",
  ARB: "ARBUSDT", OP: "OPUSDT", FIL: "FILUSDT", POL: "POLUSDT",
  SUI: "SUIUSDT", INJ: "INJUSDT", SEI: "SEIUSDT", TIA: "TIAUSDT",
  PEPE: "PEPEUSDT", WIF: "WIFUSDT", ORDI: "ORDIUSDT", STX: "STXUSDT",
  IMX: "IMXUSDT", RNDR: "RENDERUSDT", FET: "FETUSDT", ETC: "ETCUSDT",
  EOS: "EOSUSDT", ALGO: "ALGOUSDT", VET: "VETUSDT", ICP: "ICPUSDT",
};

export const CRYPTO_BASES = new Set(Object.keys(BINANCE));

interface IndexEntry {
  symbol: string;
  name: string;
  twelvedata: string;
  yahoo: string;
  stooq: string | null;
}

// investing.com-style index contracts.
const INDICES: IndexEntry[] = [
  { symbol: "US500", name: "S&P 500", twelvedata: "SPX", yahoo: "^GSPC", stooq: "^spx" },
  { symbol: "US30", name: "Dow Jones 30", twelvedata: "DJI", yahoo: "^DJI", stooq: "^dji" },
  { symbol: "NAS100", name: "Nasdaq 100", twelvedata: "NDX", yahoo: "^NDX", stooq: "^ndq" },
  { symbol: "US2000", name: "Russell 2000", twelvedata: "RUT", yahoo: "^RUT", stooq: "^rut" },
  { symbol: "UK100", name: "FTSE 100", twelvedata: "FTSE", yahoo: "^FTSE", stooq: "^ukx" },
  { symbol: "GER40", name: "DAX 40", twelvedata: "DAX", yahoo: "^GDAXI", stooq: "^dax" },
  { symbol: "FRA40", name: "CAC 40", twelvedata: "CAC", yahoo: "^FCHI", stooq: "^cac" },
  { symbol: "EU50", name: "Euro Stoxx 50", twelvedata: "STOXX50E", yahoo: "^STOXX50E", stooq: "^stx50" },
  { symbol: "JP225", name: "Nikkei 225", twelvedata: "N225", yahoo: "^N225", stooq: "^nkx" },
  { symbol: "HK50", name: "Hang Seng", twelvedata: "HSI", yahoo: "^HSI", stooq: "^hsi" },
  { symbol: "AUS200", name: "ASX 200", twelvedata: "ASX", yahoo: "^AXJO", stooq: "^ax" },
  { symbol: "ESP35", name: "IBEX 35", twelvedata: "IBEX", yahoo: "^IBEX", stooq: "^ibex" },
  { symbol: "ITA40", name: "FTSE MIB", twelvedata: "FTSEMIB", yahoo: "FTSEMIB.MI", stooq: "^mib" },
  { symbol: "DXY", name: "US Dollar Index", twelvedata: "DXY", yahoo: "DX-Y.NYB", stooq: null },
  { symbol: "VIX", name: "CBOE Volatility Index", twelvedata: "VIX", yahoo: "^VIX", stooq: "^vix" },
];

// Extra display names for common forex pairs.
const FOREX_NAMES: Record<string, string> = {
  EURUSD: "Euro / US Dollar", GBPUSD: "British Pound / US Dollar",
  USDJPY: "US Dollar / Japanese Yen", USDCHF: "US Dollar / Swiss Franc",
  USDCAD: "US Dollar / Canadian Dollar", AUDUSD: "Australian Dollar / US Dollar",
  NZDUSD: "New Zealand Dollar / US Dollar", EURGBP: "Euro / British Pound",
  EURJPY: "Euro / Japanese Yen", GBPJPY: "British Pound / Japanese Yen",
  EURCHF: "Euro / Swiss Franc", EURAUD: "Euro / Australian Dollar",
  EURCAD: "Euro / Canadian Dollar", AUDJPY: "Australian Dollar / Japanese Yen",
  AUDNZD: "Australian Dollar / New Zealand Dollar", CADJPY: "Canadian Dollar / Japanese Yen",
  CHFJPY: "Swiss Franc / Japanese Yen", NZDJPY: "New Zealand Dollar / Japanese Yen",
  GBPCHF: "British Pound / Swiss Franc", GBPAUD: "British Pound / Australian Dollar",
  GBPCAD: "British Pound / Canadian Dollar", GBPNZD: "British Pound / New Zealand Dollar",
  AUDCAD: "Australian Dollar / Canadian Dollar", AUDCHF: "Australian Dollar / Swiss Franc",
  NZDCAD: "New Zealand Dollar / Canadian Dollar", NZDCHF: "New Zealand Dollar / Swiss Franc",
  EURNZD: "Euro / New Zealand Dollar", USDSEK: "US Dollar / Swedish Krona",
  USDNOK: "US Dollar / Norwegian Krone", USDMXN: "US Dollar / Mexican Peso",
  USDZAR: "US Dollar / South African Rand", USDTRY: "US Dollar / Turkish Lira",
  USDCNH: "US Dollar / Offshore Yuan", EURSEK: "Euro / Swedish Krona",
  EURNOK: "Euro / Norwegian Krone", EURTRY: "Euro / Turkish Lira",
  EURPLN: "Euro / Polish Zloty", USDHUF: "US Dollar / Hungarian Forint",
  USDSGD: "US Dollar / Singapore Dollar", USDHKD: "US Dollar / Hong Kong Dollar",
  USDPLN: "US Dollar / Polish Zloty",
};

// A few popular stocks (work with a Twelve Data key or Yahoo).
const STOCKS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "AMD", "NFLX", "COIN", "MSTR"];

const POPULAR_CRYPTO = [
  "BTC", "ETH", "SOL", "XRP", "BNB", "ADA", "AVAX", "LINK", "DOT",
  "LTC", "BCH", "TON",
];

const CATALOG = new Map<string, SymbolMeta>();

function register(meta: SymbolMeta): void {
  CATALOG.set(meta.symbol, meta);
}

function forexMeta(symbol: string): SymbolMeta {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  return {
    symbol,
    name: FOREX_NAMES[symbol] || `${base} / ${quote}`,
    type: "forex",
    providers: {
      twelvedata: `${base}/${quote}`,
      yahoo: `${symbol}=X`,
      stooq: symbol.toLowerCase(),
    },
  };
}

function metalMeta(symbol: string): SymbolMeta {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3, 6);
  const meta: SymbolMeta = {
    symbol,
    name: `${base} / ${quote} spot`,
    type: "commodity",
    providers: {},
  };
  if (quote === "USD") {
    meta.providers.twelvedata = `${base}/${quote}`;
    meta.providers.yahoo = YAHOO_METAL[base] ?? null;
    meta.providers.stooq = symbol.toLowerCase();
    const futures = BINANCE_FUTURES[base];
    if (futures) {
      meta.providers.binanceFutures = futures;
      if (base !== "XAU") {
        meta.note = `${base} via the Binance ${futures} perpetual when no spot feed is available.`;
      }
    }
    if (base === "XAU") {
      meta.providers.binance = "PAXGUSDT";
      meta.proxy = "PAXG (gold-backed token)";
    }
  } else {
    meta.providers.twelvedata = `${base}/${quote}`;
  }
  return meta;
}

function cryptoMeta(symbol: string): SymbolMeta {
  const base = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol.replace(/USD$/, "");
  const canonical = `${base}USD`;
  return {
    symbol: canonical,
    name: `${base} / US Dollar`,
    type: "crypto",
    providers: {
      binance: BINANCE[base] ?? null,
      twelvedata: `${base}/USD`,
      yahoo: `${base}-USD`,
      stooq: null,
    },
  };
}

// ── Register the built-in catalog ──────────────────────────────────────────
for (const [symbol] of Object.entries(FOREX_NAMES)) register(forexMeta(symbol));

for (const symbol of ["XAUUSD", "XAGUSD", "XPTUSD", "XPDUSD", "XAUEUR", "XAUGBP"]) {
  register(metalMeta(symbol));
}

for (const idx of INDICES) {
  register({
    symbol: idx.symbol,
    name: idx.name,
    type: "index",
    providers: { twelvedata: idx.twelvedata, yahoo: idx.yahoo, stooq: idx.stooq },
  });
}

for (const base of Object.keys(BINANCE)) register(cryptoMeta(`${base}USD`));

for (const ticker of STOCKS) {
  register({
    symbol: ticker,
    name: ticker,
    type: "stock",
    providers: { twelvedata: ticker, yahoo: ticker, stooq: `${ticker.toLowerCase()}.us` },
  });
}

// ── Resolution ─────────────────────────────────────────────────────────────

export function normalizeSymbol(input: unknown): string {
  return String(input || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[/_,-]/g, "")
    .replace(/^\^/, "")
    .replace(/(\.US)$/, "")
    .trim();
}

export function resolveSymbol(input: unknown): SymbolMeta {
  const cleaned = normalizeSymbol(input);
  if (!cleaned) throw new Error("Empty symbol");

  const direct = CATALOG.get(cleaned);
  if (direct) return { ...direct, providers: { ...direct.providers } };

  // Crypto quoted in USDT.
  if (cleaned.endsWith("USDT")) {
    const base = cleaned.slice(0, -4);
    if (CRYPTO_BASES.has(base)) return cryptoMeta(cleaned);
  }

  // Crypto quoted in USD but not in the catalog.
  if (cleaned.endsWith("USD") && CRYPTO_BASES.has(cleaned.slice(0, -3))) {
    return cryptoMeta(cleaned);
  }

  // Six-letter pair (forex or metal), e.g. GBPJPY, XAUUSD.
  if (/^[A-Z]{6}$/.test(cleaned)) {
    const base = cleaned.slice(0, 3);
    const quote = cleaned.slice(3, 6);
    if (METALS.has(base) && FIAT.has(quote)) return metalMeta(cleaned);
    if (FIAT.has(base) && FIAT.has(quote)) return forexMeta(cleaned);
  }

  // Unknown asset: treat as a stock/ticker and let the providers try.
  if (/^[A-Z][A-Z0-9.]{0,9}$/.test(cleaned)) {
    const type: SymbolType = "stock";
    return {
      symbol: cleaned,
      name: cleaned,
      type,
      providers: { twelvedata: cleaned, yahoo: cleaned, stooq: `${cleaned.toLowerCase()}.us` },
    };
  }

  throw new Error(`Unrecognized symbol "${input}"`);
}

export function catalogList(): CatalogEntry[] {
  return [...CATALOG.values()].map((m) => ({ symbol: m.symbol, name: m.name, type: m.type }));
}

export function searchCatalog(query: unknown, limit = 12): CatalogEntry[] {
  const q = normalizeSymbol(query);
  if (!q) {
    return POPULAR_CRYPTO.map((b) => CATALOG.get(`${b}USD`)).filter(Boolean) as CatalogEntry[];
  }
  const results: CatalogEntry[] = [];
  for (const meta of CATALOG.values()) {
    if (
      meta.symbol.includes(q) ||
      meta.name.toUpperCase().includes(q) ||
      (meta.providers.twelvedata || "").toUpperCase().includes(q)
    ) {
      results.push({ symbol: meta.symbol, name: meta.name, type: meta.type });
      if (results.length >= limit) break;
    }
  }
  return results;
}
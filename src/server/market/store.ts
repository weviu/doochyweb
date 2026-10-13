// Persistence for the Analysis page's watchlist and settings.
//
// This is a single global document (`_id: "global"`) shared by every user: the
// market watchlist is not user-specific data, and this is a personal deployment.
// Ported from the standalone `gauge` project, which kept the same data in
// `data/watchlist.json` and `data/settings.json`.
//
// The Twelve Data API key is intentionally NOT a field. It is read from the
// TWELVEDATA_API_KEY environment variable only, so no third-party secret is ever
// written to the database.

import mongoose from "mongoose";

import { DEFAULT_TIMEFRAME, isTimeframeId } from "./timeframes";
import type { AnalysisSettings } from "./types";

const GLOBAL_ID = "global";

const DEFAULT_WATCHLIST = [
  "XAUUSD",
  "XAGUSD",
  "BTCUSD",
  "ETHUSD",
  "EURUSD",
  "GBPUSD",
  "US500",
  "NAS100",
  "SOLUSD",
];

const DEFAULT_SETTINGS = {
  watchlist: DEFAULT_WATCHLIST,
  refreshSeconds: 60,
  defaultTimeframe: DEFAULT_TIMEFRAME,
  strongRatio: 0.25,
  // Off by default. A market with no working data source shows an explicit
  // error rather than an invented price, because a plausible-looking fake
  // price is far worse than a visible gap.
  allowSimulated: false,
};

const marketSettingsSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: GLOBAL_ID },
  watchlist: { type: [String], default: () => [...DEFAULT_WATCHLIST] },
  refreshSeconds: { type: Number, default: DEFAULT_SETTINGS.refreshSeconds },
  defaultTimeframe: { type: String, default: DEFAULT_SETTINGS.defaultTimeframe },
  strongRatio: { type: Number, default: DEFAULT_SETTINGS.strongRatio },
  allowSimulated: { type: Boolean, default: DEFAULT_SETTINGS.allowSimulated },
  updatedAt: { type: Date, default: Date.now },
});

export const MarketSettings = mongoose.model("MarketSettings", marketSettingsSchema);

export interface StoredMarketSettings {
  watchlist: string[];
  refreshSeconds: number;
  defaultTimeframe: string;
  strongRatio: number;
  allowSimulated: boolean;
}

// Environment overrides win over the stored values so the app can be configured
// without touching the UI.
function withEnvOverrides(s: StoredMarketSettings): StoredMarketSettings {
  const merged = { ...s };
  if (process.env.REFRESH_SECONDS) {
    const n = Number(process.env.REFRESH_SECONDS);
    if (Number.isFinite(n) && n > 0) merged.refreshSeconds = n;
  }
  if (process.env.STRONG_RATIO) {
    const n = Number(process.env.STRONG_RATIO);
    if (Number.isFinite(n) && n > 0 && n <= 1) merged.strongRatio = n;
  }
  if (process.env.DEFAULT_TIMEFRAME && isTimeframeId(process.env.DEFAULT_TIMEFRAME)) {
    merged.defaultTimeframe = process.env.DEFAULT_TIMEFRAME;
  }
  return merged;
}

export async function getSettings(): Promise<StoredMarketSettings> {
  const doc = await MarketSettings.findById(GLOBAL_ID).lean().exec();
  const watchlist =
    Array.isArray(doc?.watchlist) && doc.watchlist.length ? doc.watchlist : [...DEFAULT_WATCHLIST];
  return withEnvOverrides({
    watchlist,
    refreshSeconds: doc?.refreshSeconds ?? DEFAULT_SETTINGS.refreshSeconds,
    defaultTimeframe: doc?.defaultTimeframe ?? DEFAULT_SETTINGS.defaultTimeframe,
    strongRatio: doc?.strongRatio ?? DEFAULT_SETTINGS.strongRatio,
    allowSimulated: doc?.allowSimulated ?? DEFAULT_SETTINGS.allowSimulated,
  });
}

export async function updateSettings(patch: Partial<StoredMarketSettings>): Promise<StoredMarketSettings> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (Array.isArray(patch.watchlist)) $set.watchlist = normalizeList(patch.watchlist);
  if (patch.refreshSeconds != null) $set.refreshSeconds = Math.max(10, Number(patch.refreshSeconds) || 60);
  if (patch.defaultTimeframe != null && isTimeframeId(String(patch.defaultTimeframe))) {
    $set.defaultTimeframe = String(patch.defaultTimeframe);
  }
  if (patch.strongRatio != null) {
    const n = Number(patch.strongRatio);
    if (Number.isFinite(n) && n > 0 && n <= 1) $set.strongRatio = n;
  }
  if (patch.allowSimulated != null) $set.allowSimulated = Boolean(patch.allowSimulated);
  await MarketSettings.updateOne({ _id: GLOBAL_ID }, { $set }, { upsert: true }).exec();
  return getSettings();
}

function normalizeList(list: string[]): string[] {
  return [...new Set(list.map((s) => String(s).toUpperCase()))].slice(0, 60);
}

export async function getWatchlist(): Promise<string[]> {
  return (await getSettings()).watchlist;
}

export async function setWatchlist(list: string[]): Promise<string[]> {
  const clean = normalizeList(list);
  await MarketSettings.updateOne(
    { _id: GLOBAL_ID },
    { $set: { watchlist: clean, updatedAt: new Date() } },
    { upsert: true }
  ).exec();
  return clean;
}

export async function addToWatchlist(symbol: string): Promise<string[]> {
  const list = await getWatchlist();
  const upper = String(symbol).toUpperCase();
  if (!list.includes(upper)) list.push(upper);
  return setWatchlist(list);
}

export async function removeFromWatchlist(symbol: string): Promise<string[]> {
  const upper = String(symbol).toUpperCase();
  return setWatchlist((await getWatchlist()).filter((s) => s !== upper));
}

/** The shape the API returns: no secrets, just the knobs plus whether a
 *  Twelve Data key is configured on the server. */
export async function publicSettings(): Promise<AnalysisSettings> {
  const s = await getSettings();
  return {
    refreshSeconds: s.refreshSeconds,
    defaultTimeframe: s.defaultTimeframe,
    strongRatio: s.strongRatio,
    allowSimulated: s.allowSimulated,
    twelvedataKeySet: Boolean(process.env.TWELVEDATA_API_KEY),
  };
}
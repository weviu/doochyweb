// Express router for the Analysis page: watchlist, catalog and technical
// analysis. Ported from the standalone `gauge` project's `server.js`, which
// hand-rolled the same routes over `node:http`.
//
// Mounted at /api/market by index.ts. The Analysis page is public, so the read
// routes (config, catalog, search, watchlist, analysis) are deliberately open.
// Anything that mutates shared state, or forces an upstream fetch, sits behind
// authRequired: the watchlist and settings are ONE global document, so leaving
// writes open would let any visitor rewrite them, and the per-symbol refresh
// bypasses the cache and therefore spends provider quota.

import { Router } from "express";

import { analyze, setStrongRatio } from "./analysis";
import { authRequired } from "../auth";
import { clearCache, getCandles, mapPool, MAX_SWEEP, SWEEP_CONCURRENCY } from "./providers/index";
import { catalogList, resolveSymbol, searchCatalog } from "./symbols";
import {
  addToWatchlist,
  getSettings,
  getWatchlist,
  publicSettings,
  removeFromWatchlist,
  updateSettings,
} from "./store";
import { DEFAULT_TIMEFRAME, timeframeLabels, TIMEFRAMES } from "./timeframes";
import type {
  AnalysisError,
  AnalysisResponse,
  SymbolMeta,
  TimeframeRating,
} from "./types";

export const marketRouter = Router();

marketRouter.get("/config", async (_req, res) => {
  const settings = await publicSettings();
  res.json({
    timeframes: timeframeLabels(),
    defaultTimeframe: DEFAULT_TIMEFRAME,
    settings,
    catalog: catalogList(),
  });
});

marketRouter.get("/catalog", (_req, res) => {
  res.json({ items: catalogList() });
});

marketRouter.get("/search", (req, res) => {
  res.json({ items: searchCatalog(req.query.q ?? "") });
});

marketRouter.get("/watchlist", async (_req, res) => {
  res.json({ symbols: await getWatchlist() });
});

marketRouter.post("/watchlist", authRequired, async (req, res) => {
  const symbol = req.body?.symbol;
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  let meta: SymbolMeta;
  try {
    meta = resolveSymbol(symbol);
  } catch (err) {
    res.status(400).json({ error: message(err) });
    return;
  }
  res.json({ symbols: await addToWatchlist(meta.symbol) });
});

marketRouter.delete("/watchlist", authRequired, async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  res.json({ symbols: await removeFromWatchlist(String(symbol)) });
});

marketRouter.get("/settings", async (_req, res) => {
  res.json(await publicSettings());
});

marketRouter.post("/settings", authRequired, async (req, res) => {
  const body = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (body.refreshSeconds !== undefined) patch.refreshSeconds = Number(body.refreshSeconds);
  if (body.defaultTimeframe !== undefined) patch.defaultTimeframe = String(body.defaultTimeframe);
  if (body.strongRatio !== undefined) patch.strongRatio = Number(body.strongRatio);
  if (body.allowSimulated !== undefined) patch.allowSimulated = Boolean(body.allowSimulated);
  await updateSettings(patch);
  // A settings change can invalidate every cached series (new source, new
  // sensitivity), so drop them the way the standalone server did.
  clearCache();
  res.json(await publicSettings());
});

marketRouter.get("/analysis", async (req, res) => {
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const symbols = req.query.symbols
    ? String(req.query.symbols).split(",").map((s) => s.trim()).filter(Boolean)
    : await getWatchlist();
  // The rating engine reads the strong-buy sensitivity from module state, so
  // prime it from the stored settings before every sweep.
  const { strongRatio } = await getSettings();
  setStrongRatio(strongRatio);
  const results = await mapPool(symbols, SWEEP_CONCURRENCY, (symbol) =>
    analyzeSymbol(symbol, timeframe)
  );
  res.json({ timeframe, results, updatedAt: Date.now() });
});

// Force-refresh a single symbol, bypassing the per-timeframe candle cache. Used
// by the per-card refresh control, so one market can be re-pulled without
// waiting out the TTL or re-fetching the whole watchlist.
marketRouter.post("/analysis/:symbol/refresh", authRequired, async (req, res) => {
  const symbol = req.params.symbol;
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const { strongRatio } = await getSettings();
  setStrongRatio(strongRatio);
  res.json(await analyzeSymbol(symbol, timeframe, true));
});

marketRouter.get("/analysis/:symbol", async (req, res) => {
  const symbol = req.params.symbol;
  const timeframe = req.query.timeframe ? String(req.query.timeframe) : DEFAULT_TIMEFRAME;
  const result = await analyzeSymbol(symbol, timeframe);
  if ((req.query.all === "1" || req.query.all === "true") && result.ok) {
    result.timeframeRatings = await ratingsForAllTimeframes(symbol);
  }
  res.json(result);
});

async function analyzeSymbol(
  symbol: string,
  timeframe: string,
  force = false
): Promise<AnalysisResponse | AnalysisError> {
  let meta: SymbolMeta;
  try {
    meta = resolveSymbol(symbol);
  } catch (err) {
    return { ok: false, symbol, error: message(err) };
  }
  try {
    const settings = await publicSettings();
    const { candles, provider, simulated, proxy, warnings, cached } = await getCandles(
      meta,
      timeframe,
      settings,
      { force }
    );
    const result = analyze(candles, meta, timeframe);
    return {
      ok: true,
      ...result,
      provider,
      simulated,
      proxy,
      cached,
      warnings,
      meta: { note: meta.note },
    };
  } catch (err) {
    return {
      ok: false,
      symbol: meta.symbol,
      name: meta.name,
      type: meta.type,
      timeframe,
      error: message(err),
    };
  }
}

// Compact rating (verdict + vote counts) for every timeframe, so the detail
// view can show a "Strong Buy / Buy / Sell …" label under each timeframe tab.
async function ratingsForAllTimeframes(symbol: string): Promise<Record<string, TimeframeRating>> {
  let meta: SymbolMeta;
  try {
    meta = resolveSymbol(symbol);
  } catch {
    return {};
  }
  const settings = await publicSettings();
  const entries = await mapPool(TIMEFRAMES, MAX_SWEEP, async (tf) => {
    try {
      const { candles, provider, simulated } = await getCandles(meta, tf.id, settings);
      const a = analyze(candles, meta, tf.id);
      const rating: TimeframeRating = {
        rating: a.summary.rating,
        score: a.summary.score,
        buy: a.summary.buy,
        sell: a.summary.sell,
        neutral: a.summary.neutral,
        price: a.price,
        provider,
        simulated,
      };
      return [tf.id, rating] as const;
    } catch (err) {
      return [tf.id, { error: message(err) }] as const;
    }
  });
  return Object.fromEntries(entries);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
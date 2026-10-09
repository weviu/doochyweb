import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, Settings2 } from "lucide-react";

import { marketApi } from "../api";
import { FadeRise } from "../components/motion";
import { Card } from "../components/ui";
import { MarketCard, MarketCardError, MarketCardSkeleton } from "./MarketCard";
import { MarketDetail } from "./MarketDetail";
import { MarketSettingsSheet } from "./MarketSettingsSheet";
import { DEFAULT_TIMEFRAME, timeframes as staticTimeframes } from "./timeframes";
import type { CatalogEntry, MarketResult, MarketSettings } from "./types";

export default function AnalysisPage() {
  const [config, setConfig] = useState<{
    timeframes: { id: string; label: string }[];
    settings: MarketSettings;
    catalog: CatalogEntry[];
  } | null>(null);

  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [results, setResults] = useState<MarketResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());

  const [detail, setDetail] = useState<{ symbol: string; timeframe: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [symbolInput, setSymbolInput] = useState("");

  const timeframes = config?.timeframes ?? staticTimeframes;
  const settings = config?.settings;
  const strongRatio = settings?.strongRatio ?? 0.25;
  const refreshSeconds = settings?.refreshSeconds ?? 60;

  // Guards against a slow response from an earlier request overwriting a newer
  // one (switching timeframe mid-flight is common).
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await marketApi.analysis(timeframe);
      if (id !== reqId.current) return;
      setResults(res.results);
      setUpdatedAt(res.updatedAt);
      setError(null);
      setSecondsLeft(refreshSeconds);
    } catch (err) {
      if (id !== reqId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load analysis");
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [timeframe, refreshSeconds]);

  // One-shot bootstrap: config + watchlist drives the initial render.
  useEffect(() => {
    let alive = true;
    marketApi
      .config()
      .then((c) => {
        if (!alive) return;
        setConfig({ timeframes: c.timeframes, settings: c.settings, catalog: c.catalog });
        setTimeframe(c.settings.defaultTimeframe || c.defaultTimeframe || DEFAULT_TIMEFRAME);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Auto-refresh loop, re-created whenever the interval or timeframe changes.
  useEffect(() => {
    void load();
    const poll = window.setInterval(load, Math.max(10, refreshSeconds) * 1000);
    return () => window.clearInterval(poll);
  }, [load, refreshSeconds]);

  // Countdown ticker. Lives in StatusLine so a tick re-renders only that strip
  // and not the whole grid.
  useEffect(() => {
    const t = window.setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const addSymbol = useCallback(
    async (raw: string) => {
      const symbol = raw.trim();
      if (!symbol) return;
      setSymbolInput("");
      try {
        await marketApi.addSymbol(symbol);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add market");
      }
    },
    [load]
  );

  const removeSymbol = useCallback(
    async (symbol: string) => {
      setResults((prev) => prev.filter((r) => r.symbol !== symbol));
      try {
        await marketApi.removeSymbol(symbol);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove market");
      }
    },
    [load]
  );

  // Stable per-card handlers: the cards are memoised, so handing them a fresh
  // closure each render would defeat the memo entirely.
  const openDetail = useCallback(
    (symbol: string) => setDetail({ symbol, timeframe }),
    [timeframe]
  );

  const refreshOne = useCallback(
    async (symbol: string) => {
      setRefreshing((prev) => new Set(prev).add(symbol));
      try {
        const result = await marketApi.refreshSymbol(symbol, timeframe);
        // Splice just this card in, so the rest of the grid is untouched.
        setResults((prev) => prev.map((r) => (r.symbol === symbol ? result : r)));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to refresh ${symbol}`);
      } finally {
        setRefreshing((prev) => {
          const next = new Set(prev);
          next.delete(symbol);
          return next;
        });
      }
    },
    [timeframe]
  );

  const okCount = results.filter((r) => r.ok).length;
  const simCount = results.filter((r) => r.ok && r.simulated).length;
  // Markets showing simulator output because a real source is down. Worth an
  // explicit callout: the prices on those cards are not real.
  const degraded = results.filter(
    (r) => r.ok && r.simulated && (r.warnings?.length ?? 0) > 0
  ).length;

  return (
    <FadeRise>
      <div className="space-y-3">
        {/* Toolbar: timeframes + add market + refresh + settings */}
        <Card flat className="flex flex-col gap-2.5 p-3">
          <div className="flex flex-wrap items-center gap-1">
            {timeframes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTimeframe(t.id)}
                className={
                  "rounded-md px-2.5 py-1 text-xs font-medium transition " +
                  (t.id === timeframe
                    ? "border border-accent/20 bg-accent-soft text-accent"
                    : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addSymbol(symbolInput);
            }}
            className="flex gap-2"
          >
            <input
              list="market-suggestions"
              autoComplete="off"
              spellCheck={false}
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              placeholder="Add market — XAUUSD, BTC, NAS100, AAPL…"
              aria-label="Add market"
              className="w-full rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <datalist id="market-suggestions">
              {(config?.catalog ?? []).map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.name} ({c.type})
                </option>
              ))}
            </datalist>
            <button
              type="submit"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:bg-accent-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </form>
        </Card>

        <StatusLine
          loading={loading}
          okCount={okCount}
          total={results.length}
          simCount={simCount}
          secondsLeft={secondsLeft}
          onOpenSettings={() => setShowSettings(true)}
          onRefresh={() => void load()}
        />

        {degraded > 0 && (
          <Card flat className="flex items-start gap-2 border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-fg-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              {degraded} market{degraded === 1 ? "" : "s"} showing{" "}
              <strong className="text-fg">simulated</strong> data because every real source
              failed or is temporarily disabled. Set{" "}
              <code className="text-fg">TWELVEDATA_API_KEY</code> in the server environment to get
              real forex, metals, index and stock prices.
            </span>
          </Card>
        )}

        {error && (
          <Card flat className="border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {error}
          </Card>
        )}

        {loading && results.length === 0 ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <MarketCardSkeleton key={i} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Card flat className="p-8 text-center">
            <div className="text-sm text-fg-muted">Your watchlist is empty.</div>
            <div className="mt-1 text-xs text-fg-faint">Add a market above to start analysing.</div>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {results.map((r) =>
              r.ok ? (
                <MarketCard
                  key={r.symbol}
                  analysis={r}
                  strongRatio={strongRatio}
                  refreshing={refreshing.has(r.symbol)}
                  onOpen={openDetail}
                  onRefresh={refreshOne}
                  onRemove={removeSymbol}
                />
              ) : (
                <MarketCardError
                  key={r.symbol}
                  symbol={r.symbol}
                  error={r.error}
                  refreshing={refreshing.has(r.symbol)}
                  onRefresh={refreshOne}
                  onRemove={removeSymbol}
                />
              )
            )}
          </div>
        )}

        <p className="pb-2 text-center text-[11px] leading-relaxed text-fg-faint">
          Indicators computed server-side (RSI, STOCH, MACD, ADX, CCI, Williams %R, ATR, Ultimate
          Oscillator, ROC, Bull/Bear Power, SMA/EMA 5–200). Not financial advice.
        </p>
      </div>

      {detail && (
        <MarketDetail
          symbol={detail.symbol}
          timeframe={detail.timeframe}
          strongRatio={strongRatio}
          timeframes={timeframes}
          onClose={() => setDetail(null)}
          onRemove={(s) => void removeSymbol(s)}
          onTimeframeChange={(tf) => setDetail((d) => (d ? { ...d, timeframe: tf } : d))}
        />
      )}

      {showSettings && settings && (
        <MarketSettingsSheet
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setConfig((c) => (c ? { ...c, settings: s } : c));
            void load();
          }}
        />
      )}
    </FadeRise>
  );
}

// Split out so the per-second countdown tick re-renders only this strip. It is
// memoised and takes primitives, so the grid below is untouched.
function StatusLine({
  loading,
  okCount,
  total,
  simCount,
  secondsLeft,
  onOpenSettings,
  onRefresh,
}: {
  loading: boolean;
  okCount: number;
  total: number;
  simCount: number;
  secondsLeft: number;
  onOpenSettings: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-fg-muted">
        {loading
          ? "Updating…"
          : `${okCount}/${total} markets analysed${simCount ? ` · ${simCount} simulated` : ""}`}
      </span>
      <span className="flex items-center gap-2 text-fg-faint">
        {secondsLeft > 0 && !loading && <span>Next refresh in {secondsLeft}s</span>}
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded p-1 transition hover:bg-surface-hover hover:text-fg"
          aria-label="Analysis settings"
          title="Analysis settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded p-1 transition hover:bg-surface-hover hover:text-fg"
          aria-label="Refresh now"
          title="Refresh now"
        >
          <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
        </button>
      </span>
    </div>
  );
}

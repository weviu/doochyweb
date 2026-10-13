import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Save } from "lucide-react";

import { AnimatedModal } from "../components/Modal";
import { Button, Flash, Toggle, inputCls } from "../components/ui";
import { marketApi } from "../api";
import { timeframes } from "./timeframes";
import type { MarketSettings } from "./types";

export function MarketSettingsSheet({
  settings,
  onClose,
  onSaved,
}: {
  settings: MarketSettings;
  onClose: () => void;
  onSaved: (s: MarketSettings) => void;
}) {
  const [refreshSeconds, setRefreshSeconds] = useState(String(settings.refreshSeconds));
  const [defaultTimeframe, setDefaultTimeframe] = useState(settings.defaultTimeframe);
  const [strongRatio, setStrongRatio] = useState(String(settings.strongRatio));
  const [allowSimulated, setAllowSimulated] = useState(settings.allowSimulated);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRefreshSeconds(String(settings.refreshSeconds));
    setDefaultTimeframe(settings.defaultTimeframe);
    setStrongRatio(String(settings.strongRatio));
    setAllowSimulated(settings.allowSimulated);
  }, [settings]);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const next = await marketApi.saveSettings({
        refreshSeconds: Number(refreshSeconds),
        defaultTimeframe,
        strongRatio: Number(strongRatio),
        allowSimulated,
      });
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  }

  return (
    <AnimatedModal open onClose={onClose} title="Analysis settings">
      <div className="space-y-4">
        {error && <Flash tone="danger">{error}</Flash>}
        {saved && !error && <Flash tone="success">Settings saved</Flash>}

        {settings.twelvedataKeySet ? (
          <div className="flex gap-2.5 rounded-xl border border-success/25 bg-success-soft/50 p-3 text-xs leading-relaxed text-fg-muted">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>
              <strong className="text-fg">Twelve Data key detected</strong>, so forex, indices and
              stocks are served live. Two caveats on the free plan: it allows only{" "}
              <strong className="text-fg">8 credits per minute</strong> (a wide watchlist on a short
              refresh will hit that ceiling), and <code className="text-fg">XAG/USD</code> silver spot
              is a paid-tier symbol. Crypto comes from Binance either way.
            </span>
          </div>
        ) : (
          <div className="flex gap-2.5 rounded-xl border border-accent/25 bg-gradient-to-r from-accent/12 to-blue-500/8 p-3 text-xs leading-relaxed text-fg-muted">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>
              No Twelve Data key is configured, so forex, metals, indices and stocks fall back to
              Yahoo/Stooq and then to a clearly-labelled simulator. Crypto is always live via
              Binance. Set <code className="text-accent">TWELVEDATA_API_KEY</code> in the server
              environment to enable every asset class.
            </span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="m-refresh" className="text-xs font-medium text-fg-muted">
            Auto-refresh (seconds)
          </label>
          <input
            id="m-refresh"
            type="number"
            min={10}
            max={3600}
            className={inputCls}
            value={refreshSeconds}
            onChange={(e) => setRefreshSeconds(e.target.value)}
          />
          <p className="text-xs text-fg-faint">
            Shorter intervals hit provider rate limits faster. 60s is a sensible floor for free tiers.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="m-tf" className="text-xs font-medium text-fg-muted">
            Default timeframe
          </label>
          <select
            id="m-tf"
            className={inputCls}
            value={defaultTimeframe}
            onChange={(e) => setDefaultTimeframe(e.target.value)}
          >
            {timeframes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-hairline bg-soft p-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-fg">Simulated data</div>
            <p className="mt-1 text-xs leading-relaxed text-fg-faint">
              Off by default. When a market has no working data source it shows an error
              instead of a made-up price, which is far safer than a plausible-looking fake
              one. Turn this on only if you want every card to always render.
            </p>
          </div>
          <Toggle label="" ariaLabel="Allow simulated data" checked={allowSimulated} onToggle={setAllowSimulated} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="m-strong" className="text-xs font-medium text-fg-muted">
            Strong Buy/Sell sensitivity
          </label>
          <input
            id="m-strong"
            type="number"
            step={0.05}
            min={0.05}
            max={1}
            className={inputCls}
            value={strongRatio}
            onChange={(e) => setStrongRatio(e.target.value)}
          />
          <p className="text-xs text-fg-faint">
            Net buy/sell vote ratio that upgrades Buy/Sell to Strong. Lower triggers more easily
            (default 0.25).
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClickAsync={save}>
          Save
        </Button>
      </div>
    </AnimatedModal>
  );
}
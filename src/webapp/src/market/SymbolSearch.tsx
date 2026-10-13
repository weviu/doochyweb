import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";

import type { CatalogEntry } from "./types";

// Add-market combobox. Replaces the native <datalist>, whose dropdown cannot be
// styled and renders differently in every browser. Suggestions are filtered
// locally over the catalog the server already sent with /api/market/config, so
// typing is instant with no request per keystroke.
//
// Any text the user types is still accepted: the server resolves bare tickers
// (AAPL, XYZ) that are not in the catalog.

const POPULAR = [
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "EURUSD", "GBPUSD", "US500", "NAS100", "SOLUSD",
];

const MAX_RESULTS = 8;

function score(entry: CatalogEntry, q: string): number | null {
  // Lower is better; null means "no match".
  const sym = entry.symbol;
  if (sym === q) return 0;
  if (sym.startsWith(q)) return 1;
  if (sym.includes(q)) return 2;
  if (entry.name.toUpperCase().includes(q)) return 3;
  return null;
}

export function SymbolSearch({
  catalog,
  onAdd,
  disabled,
}: {
  catalog: CatalogEntry[];
  onAdd: (symbol: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = value.trim().toUpperCase();
    if (!q) {
      return POPULAR.map((sym) => catalog.find((c) => c.symbol === sym)).filter(
        (c): c is CatalogEntry => Boolean(c)
      );
    }
    return catalog
      .map((c) => ({ c, s: score(c, q) }))
      .filter((x): x is { c: CatalogEntry; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s || a.c.symbol.localeCompare(b.c.symbol))
      .slice(0, MAX_RESULTS)
      .map((x) => x.c);
  }, [catalog, value]);

  const showPanel = open && results.length > 0;

  // Close when focus or a click leaves the widget.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Keep the highlighted row inside range as the result set changes.
  useEffect(() => {
    setActive(0);
  }, [value]);

  function pick(symbol: string) {
    setValue(symbol);
    setOpen(false);
    // Deliberately no refocus: the input already holds focus (option clicks use
    // mousedown-preventDefault to avoid blurring), and re-focusing would fire
    // onFocus and immediately re-open the panel the user just dismissed.
  }

  function submit(raw: string) {
    const symbol = raw.trim();
    if (!symbol) return;
    onAdd(symbol);
    setValue("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
      return;
    }
    if (e.key === "Enter") {
      // A highlighted suggestion wins over the raw text; otherwise submit it.
      if (showPanel && results[active]) {
        e.preventDefault();
        pick(results[active].symbol);
        return;
      }
      e.preventDefault();
      submit(value);
      return;
    }
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (showPanel && results[active]) pick(results[active].symbol);
          else submit(value);
        }}
        className="relative flex gap-2"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
        <input
          ref={inputRef}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="market-suggestions-listbox"
          aria-autocomplete="list"
          aria-activedescendant={showPanel ? `market-opt-${results[active]?.symbol}` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Add market: XAUUSD, BTC, NAS100, AAPL…"
          aria-label="Add market"
          className={
            "w-full rounded-lg border border-hairline-strong bg-soft py-1.5 pl-9 pr-9 text-sm text-fg " +
            "placeholder:text-fg-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 " +
            "disabled:opacity-50"
          }
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-faint transition hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          type="submit"
          disabled={disabled}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-fg transition duration-150 hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </form>

      {showPanel && (
        <div
          id="market-suggestions-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-hairline-strong bg-gradient-to-b from-surface-hover to-surface shadow-overlay"
        >
          {!value.trim() && (
            <div className="border-b border-hairline px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-faint">
              Popular
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li
                key={r.symbol}
                id={`market-opt-${r.symbol}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  // mousedown beats blur, so the click lands before the panel closes.
                  e.preventDefault();
                  pick(r.symbol);
                }}
                className={
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm transition duration-150 " +
                  (i === active ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-hover")
                }
              >
                <span className="min-w-0">
                  <span className="font-semibold">{r.symbol}</span>
                  <span className="ml-2 text-xs opacity-70">{r.name}</span>
                </span>
                <span className="shrink-0 rounded-[5px] border border-hairline bg-soft px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-fg-faint">
                  {r.type}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-1.5 text-[10.5px] text-fg-faint">
            <span>↑↓ to navigate · ↵ to select</span>
            <span>Any ticker is accepted</span>
          </div>
        </div>
      )}
    </div>
  );
}

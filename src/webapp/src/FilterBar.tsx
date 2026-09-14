import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { OrderRow, PositionRow } from "./api";
import type { ViewMode } from "./Dashboard";

export type SortKey =
  | "symbol"
  | "side"
  | "lots"
  | "entryPrice"
  | "price"
  | "netUsd"
  | "stopLoss"
  | "takeProfit"
  | "openTimestamp"
  | "expirationTimestamp"
  | "orderType"
  | "account";

export type NetState = "any" | "profit" | "loss";

export interface FilterState {
  search: string;
  symbolsSel: string[];
  sides: string[];
  orderTypesSel: string[];
  netState: NetState;
  netMin: number | null;
  netMax: number | null;
  distMin: number | null;
  distMax: number | null;
  sortKey: SortKey;
  sortAsc: boolean;
}

export type FilterPatch = Partial<FilterState>;

export const DEFAULT_FILTER: FilterState = {
  search: "",
  symbolsSel: [],
  sides: [],
  orderTypesSel: [],
  netState: "any",
  netMin: null,
  netMax: null,
  distMin: null,
  distMax: null,
  sortKey: "openTimestamp",
  sortAsc: false,
};

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function netMatches(p: PositionRow, st: FilterState): boolean {
  if (st.netState === "any") return true;
  if (p.netUsd == null) return false;
  const okState = st.netState === "profit" ? p.netUsd > 0 : p.netUsd < 0;
  if (!okState) return false;
  if (st.netMin != null && p.netUsd < st.netMin) return false;
  if (st.netMax != null && p.netUsd > st.netMax) return false;
  return true;
}

function distFromMarket(o: OrderRow): number | null {
  if (o.price == null) return null;
  const other = o.takeProfit ?? o.stopLoss;
  if (other == null) return null;
  return Math.abs(o.price - other);
}

// Combined-mode account label used for the Account sort (nickname when set,
// otherwise the login number). Rows without an account sort as empty.
function accountLabel(r: PositionRow | OrderRow): string {
  const acct = r.account;
  if (!acct) return "";
  return acct.nickname ? String(acct.nickname) : String(acct.login);
}

export function applyFilter<T extends PositionRow | OrderRow>(
  rows: readonly T[],
  st: FilterState
): T[] {
  const q = st.search.trim().toLowerCase();
  const syms = new Set(st.symbolsSel);
  const sides = new Set(st.sides);
  const types = new Set(st.orderTypesSel);

  return rows.filter((r) => {
    if (syms.size > 0 && !syms.has(r.symbol)) return false;
    if (sides.size > 0 && !sides.has(r.side)) return false;
    if ("positionId" in r) {
      if (!netMatches(r as PositionRow, st)) return false;
    } else {
      if (types.size > 0 && !types.has((r as OrderRow).orderType)) return false;
      const d = distFromMarket(r as OrderRow);
      if (st.distMin != null && (d == null || d < st.distMin)) return false;
      if (st.distMax != null && (d == null || d > st.distMax)) return false;
    }
    if (!q) return true;
    const symLower = r.symbol.toLowerCase();
    return (
      symLower.includes(q) ||
      r.side.toLowerCase().includes(q) ||
      ("positionId" in r
        ? String((r as PositionRow).positionId).includes(q)
        : String((r as OrderRow).orderId).includes(q))
    );
  });
}

function cmpVal(a: number | null | undefined, b: number | null | undefined): number {
  const A = a ?? Number.NEGATIVE_INFINITY;
  const B = b ?? Number.NEGATIVE_INFINITY;
  return A === B ? 0 : A < B ? -1 : 1;
}

export function sortRows<T extends PositionRow | OrderRow>(
  rows: readonly T[],
  key: SortKey,
  asc: boolean
): T[] {
  const dir = asc ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    let c = 0;
    switch (key) {
      case "symbol":
        c = a.symbol.localeCompare(b.symbol);
        break;
      case "side":
        c = a.side.localeCompare(b.side);
        break;
      case "lots":
        c = cmpVal(a.lots, b.lots);
        break;
      case "entryPrice":
        c = cmpVal("entryPrice" in a ? a.entryPrice : null, "entryPrice" in b ? b.entryPrice : null);
        break;
      case "price":
        c = cmpVal("price" in a ? (a as OrderRow).price : null, "price" in b ? (b as OrderRow).price : null);
        break;
      case "netUsd":
        c = cmpVal("netUsd" in a ? a.netUsd : null, "netUsd" in b ? b.netUsd : null);
        break;
      case "stopLoss":
        c = cmpVal(a.stopLoss, b.stopLoss);
        break;
      case "takeProfit":
        c = cmpVal(a.takeProfit, b.takeProfit);
        break;
      case "openTimestamp":
        c = cmpVal("openTimestamp" in a ? a.openTimestamp : null, "openTimestamp" in b ? b.openTimestamp : null);
        break;
      case "expirationTimestamp":
        c = cmpVal("expirationTimestamp" in a ? a.expirationTimestamp : null, "expirationTimestamp" in b ? b.expirationTimestamp : null);
        break;
      case "orderType":
        c = ("orderType" in a ? a.orderType : "").localeCompare("orderType" in b ? b.orderType : "");
        break;
      case "account":
        c = accountLabel(a).localeCompare(accountLabel(b));
        break;
      default:
        c = 0;
    }
    return c * dir || (a.symbol.localeCompare(b.symbol) || 0);
  });
  return sorted;
}

// Clickable table-header cell that sorts by its column. First click on a column
// sorts ascending; clicking the active column again toggles the direction.
export function SortTh({
  label,
  k,
  state,
  onPatch,
  className,
}: {
  label: string;
  k: SortKey;
  state: FilterState;
  onPatch: (p: FilterPatch) => void;
  className?: string;
}) {
  const active = state.sortKey === k;
  return (
    <th className={className}>
      <button
        type="button"
        className={`sort-th ${active ? "sort-th-on" : ""}`}
        onClick={() => onPatch(active ? { sortAsc: !state.sortAsc } : { sortKey: k, sortAsc: true })}
        title={active ? (state.sortAsc ? "Sorted ascending" : "Sorted descending") : `Sort by ${label}`}
      >
        {label}
        <span className={`sort-arrow ${active ? "" : "inactive"}`}>
          {active ? (state.sortAsc ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

const STORAGE_POS = "doochyweb_pos_filters";
const STORAGE_ORD = "doochyweb_ord_filters";

export function loadFilter(orders: boolean): FilterState {
  const key = orders ? STORAGE_ORD : STORAGE_POS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_FILTER };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FILTER, ...parsed };
  } catch {
    return { ...DEFAULT_FILTER };
  }
}

export function saveFilter(orders: boolean, st: FilterState): void {
  try {
    localStorage.setItem(orders ? STORAGE_ORD : STORAGE_POS, JSON.stringify(st));
  } catch {
    /* ignore */
  }
}

export function uniqueSymbols(rows: readonly (PositionRow | OrderRow)[]): string[] {
  return Array.from(new Set(rows.map((r) => r.symbol))).sort((a, b) => a.localeCompare(b));
}

export default function FilterBar({
  mode,
  orders,
  positions,
  symbols,
  orderTypes,
  state,
  onChange,
}: {
  mode: ViewMode;
  orders?: boolean;
  positions?: boolean;
  symbols: string[];
  orderTypes?: string[];
  state: FilterState;
  onChange: (patch: FilterPatch) => void;
}) {
  const [symOpen, setSymOpen] = useState(false);
  const [symQuery, setSymQuery] = useState("");
  const [activeSym, setActiveSym] = useState(-1);
  const symRef = useRef<HTMLDivElement>(null);
  const symInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDoc(ev: MouseEvent) {
      if (symRef.current && !symRef.current.contains(ev.target as Node)) setSymOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const symMatches = useMemo(() => {
    const q = symQuery.trim().toUpperCase();
    const all = q ? symbols.filter((s) => s.toUpperCase().includes(q)) : symbols;
    return all.filter((s) => !state.symbolsSel.includes(s)).slice(0, 50);
  }, [symbols, symQuery, state.symbolsSel]);

  function addSymbol(s: string): void {
    if (!state.symbolsSel.includes(s)) onChange({ symbolsSel: [...state.symbolsSel, s] });
    setSymQuery("");
    setActiveSym(-1);
    setSymOpen(true);
    symInputRef.current?.focus();
  }

  function deleteSymbol(s: string): void {
    onChange({ symbolsSel: state.symbolsSel.filter((x) => x !== s) });
  }

  function onSymKey(ev: KeyboardEvent<HTMLInputElement>): void {
    if (ev.key === "Escape") {
      setSymOpen(false);
      return;
    }
    if (!symOpen || symMatches.length === 0) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveSym((i) => (i + 1) % symMatches.length);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveSym((i) => (i <= 0 ? symMatches.length - 1 : i - 1));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const pick = symMatches[activeSym >= 0 ? activeSym : 0];
      if (pick) addSymbol(pick);
    }
  }

  const hasActive =
    state.search.trim() !== "" ||
    state.symbolsSel.length > 0 ||
    state.sides.length > 0 ||
    state.orderTypesSel.length > 0 ||
    state.netState !== "any" ||
    state.netMin != null ||
    state.netMax != null ||
    state.distMin != null ||
    state.distMax != null;

  return (
    <div className={`filter-bar ${orders ? "filter-orders" : "filter-positions"}`}>
      <div className="filter-row-main">
        <label className="filter-search">
          <svg className="ic" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="search"
            placeholder={orders ? "Search pending orders…" : "Search positions…"}
            value={state.search}
            onChange={(e) => onChange({ search: e.target.value })}
            aria-label="Search"
          />
        </label>

        <div className="filter-sym" ref={symRef}>
          <div className="filter-sym-input">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <input
              ref={symInputRef}
              type="text"
              placeholder="Symbol…"
              value={symQuery}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setSymQuery(e.target.value);
                setActiveSym(-1);
                setSymOpen(true);
              }}
              onFocus={() => setSymOpen(true)}
              onKeyDown={onSymKey}
              aria-label="Add symbol filter"
            />
            {state.symbolsSel.length > 0 && (
              <button
                type="button"
                className="filter-sym-clear"
                title="Clear all symbol filters"
                onClick={() => onChange({ symbolsSel: [] })}
              >
                ✕
              </button>
            )}
          </div>
          {symOpen && (
            <div className="filter-sym-pop">
              {symMatches.length === 0 ? (
                <div className="filter-none">
                  {symQuery ? "No matching symbols" : "No symbols available"}
                </div>
              ) : (
                symMatches.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={`filter-opt ${i === activeSym ? "active" : ""}`}
                    onMouseEnter={() => setActiveSym(i)}
                    onClick={() => addSymbol(s)}
                  >
                    <span className="mono">{s}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="filter-sides">
          <span className="filter-ph">Side</span>
          <button
            type="button"
            className={`filter-pill ${state.sides.length === 0 ? "on" : ""}`}
            onClick={() => onChange({ sides: [] })}
          >
            Any
          </button>
          {["BUY", "SELL"].map((sd) => (
            <button
              key={sd}
              type="button"
              className={`filter-pill ${state.sides.includes(sd) ? "on" : ""}`}
              onClick={() => onChange({ sides: toggleIn(state.sides, sd) })}
            >
              {sd}
            </button>
          ))}
        </div>

        {orders && orderTypes && orderTypes.length > 0 && (
          <div className="filter-types">
            <span className="filter-ph">Type</span>
            <button
              type="button"
              className={`filter-pill ${state.orderTypesSel.length === 0 ? "on" : ""}`}
              onClick={() => onChange({ orderTypesSel: [] })}
            >
              Any
            </button>
            {orderTypes.map((t) => (
              <button
                key={t}
                type="button"
                className={`filter-pill ${state.orderTypesSel.includes(t) ? "on" : ""}`}
                onClick={() => onChange({ orderTypesSel: toggleIn(state.orderTypesSel, t) })}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {(positions && state.netState !== "any") && (
          <div className="filter-net">
            <span className="filter-ph">Net P/L</span>
            <select
              value={state.netState}
              onChange={(e) => onChange({ netState: e.target.value as NetState })}
              aria-label="Net P/L"
            >
              <option value="any">Any</option>
              <option value="profit">Profit</option>
              <option value="loss">Loss</option>
            </select>
            <input
              type="number"
              className="filter-input"
              placeholder="min $"
              value={state.netMin ?? ""}
              onChange={(e) => onChange({ netMin: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <span className="filter-dash">–</span>
            <input
              type="number"
              className="filter-input"
              placeholder="max $"
              value={state.netMax ?? ""}
              onChange={(e) => onChange({ netMax: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
        )}

        {orders && (
          <div className="filter-dist">
            <span className="filter-ph">Dist (pts)</span>
            <input
              type="number"
              className="filter-input"
              placeholder="min"
              value={state.distMin ?? ""}
              onChange={(e) => onChange({ distMin: e.target.value === "" ? null : Number(e.target.value) })}
            />
            <span className="filter-dash">–</span>
            <input
              type="number"
              className="filter-input"
              placeholder="max"
              value={state.distMax ?? ""}
              onChange={(e) => onChange({ distMax: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </div>
        )}

        {hasActive && (
          <button
            type="button"
            className="filter-reset"
            onClick={() =>
              onChange({
                search: "",
                symbolsSel: [],
                sides: [],
                orderTypesSel: [],
                netState: "any",
                netMin: null,
                netMax: null,
                distMin: null,
                distMax: null,
              })
            }
          >
            Reset
          </button>
        )}
      </div>

      {(state.symbolsSel.length > 0 || state.sides.length > 0 || state.orderTypesSel.length > 0) && (
        <div className="filter-chips">
          {state.symbolsSel.map((s) => (
            <span key={s} className="filter-chip" onClick={() => deleteSymbol(s)} title="Remove symbol">
              <span className="mono">{s}</span>
              <span className="filter-chip-x">✕</span>
            </span>
          ))}
          {state.sides.map((s) => (
            <span key={s} className="filter-chip" onClick={() => onChange({ sides: state.sides.filter((x) => x !== s) })} title="Remove side">
              {s}
              <span className="filter-chip-x">✕</span>
            </span>
          ))}
          {state.orderTypesSel.map((t) => (
            <span key={t} className="filter-chip" onClick={() => onChange({ orderTypesSel: state.orderTypesSel.filter((x) => x !== t) })} title="Remove type">
              {t}
              <span className="filter-chip-x">✕</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

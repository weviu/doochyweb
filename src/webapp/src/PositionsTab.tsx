import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountView, ApiError, PositionRow, RowAccount, api } from "./api";
import { AccountCell, ViewMode, fmtLots, fmtMoney, fmtPrice, fmtTime } from "./Dashboard";
import FilterBar, {
  applyFilter,
  FilterPatch,
  FilterState,
  loadFilter,
  saveFilter,
  sortRows,
  uniqueSymbols,
  SortTh,
} from "./FilterBar";

const POLL_MS = 8000;

function fmtNetUsd(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${fmtMoney(n)}`;
}

export default function PositionsTab({
  mode,
  accounts,
  ctid,
  isLive,
}: {
  mode: ViewMode;
  accounts: AccountView[];
  ctid: number | null;
  isLive: boolean;
}) {
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => loadFilter(false));
  const timer = useRef<number | null>(null);

  const patchFilters = useCallback((p: FilterPatch) => {
    setFilters((f) => {
      const next = { ...f, ...p };
      saveFilter(false, next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      if (mode === "combined") {
        const settled = await Promise.all(
          accounts.map(async (a) => {
            try {
              const { positions } = await api.positions(a.ctid);
              const acct: RowAccount = { ctid: a.ctid, login: a.login, isLive: a.isLive, nickname: a.nickname };
              return positions.map((p) => ({ ...p, account: acct })) as PositionRow[];
            } catch {
              return null;
            }
          })
        );
        const merged = settled.flat(1).filter((b): b is PositionRow => b !== null);
        setRows(merged);
        setError(
          accounts.length > 0 && merged.length === 0 && settled.every((b) => b === null)
            ? "Failed to load positions"
            : null
        );
      } else if (ctid != null) {
        const { positions } = await api.positions(ctid);
        setRows(positions);
        setError(null);
      }
      setLastUpdated(Date.now());
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err.message || "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [mode, accounts, ctid]);

  useEffect(() => {
    setLoading(true);
    load();
    timer.current = window.setInterval(load, POLL_MS);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [load]);

  const combined = mode === "combined";
  const shown = applyFilter(rows, filters);
  const sorted = sortRows(shown, filters.sortKey, filters.sortAsc);

  const symbols = useMemo(() => uniqueSymbols(rows), [rows]);

  return (
    <div className="panel">
      <div className="panel-head">
        {combined ? (
          <span className="env-tag env-all">ALL</span>
        ) : (
          <span className={`env-tag ${isLive ? "env-live" : "env-demo"}`}>{isLive ? "LIVE" : "DEMO"}</span>
        )}
        <span className="panel-count">{sorted.length} open</span>
        <span className="panel-meta">{lastUpdated ? `updated ${new Date(lastUpdated).toLocaleTimeString()}` : ""}</span>
        <button className="ghost small" onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <FilterBar
        mode={mode}
        positions
        orders={false}
        state={filters}
        onChange={patchFilters}
        symbols={symbols}
        orderTypes={[]}
      />

      {error && <div className="error-banner">{error}</div>}

      {sorted.length === 0 && !loading ? (
        <div className="table-empty">No positions match.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {combined && <SortTh label="Account" k="account" state={filters} onPatch={patchFilters} />}
              <SortTh label="Symbol" k="symbol" state={filters} onPatch={patchFilters} />
              <SortTh label="Side" k="side" state={filters} onPatch={patchFilters} />
              <SortTh label="Lots" k="lots" state={filters} onPatch={patchFilters} />
              <SortTh label="Entry" k="entryPrice" state={filters} onPatch={patchFilters} />
              <SortTh label="SL" k="stopLoss" state={filters} onPatch={patchFilters} />
              <SortTh label="TP" k="takeProfit" state={filters} onPatch={patchFilters} />
              <SortTh className="num center" label="Net USD" k="netUsd" state={filters} onPatch={patchFilters} />
              <SortTh label="Opened" k="openTimestamp" state={filters} onPatch={patchFilters} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={combined && p.account ? `${p.account.ctid}:${p.positionId}` : p.positionId}>
                {combined && p.account && AccountCell(p.account)}
                <td className="mono">{p.symbol}</td>
                <td className={p.side === "BUY" ? "side-buy" : "side-sell"}>{p.side}</td>
                <td className="num">{fmtLots(p.lots)}</td>
                <td className="num">{fmtPrice(p.entryPrice, p.digits)}</td>
                <td className="num">{fmtPrice(p.stopLoss, p.digits)}</td>
                <td className="num">{fmtPrice(p.takeProfit, p.digits)}</td>
                <td className={`num center ${p.netUsd == null ? "dim" : p.netUsd >= 0 ? "pnl-pos" : "pnl-neg"}`}>
                  {fmtNetUsd(p.netUsd)}
                </td>
                <td className="num dim">{fmtTime(p.openTimestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
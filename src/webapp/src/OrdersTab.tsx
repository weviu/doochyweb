import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, OrderRow, RowAccount, api } from "./api";
import { AccountCell, ViewMode, fmtLots, fmtPrice } from "./Dashboard";
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

function orderTypeLabel(t: string): string {
  switch (t) {
    case "LIMIT":
      return "Limit";
    case "STOP":
      return "Stop";
    case "STOP_LOSS_TAKE_PROFIT":
      return "SL/TP";
    default:
      return t || "—";
  }
}

export default function OrdersTab({
  mode,
  accounts,
  ctid,
  isLive,
}: {
  mode: ViewMode;
  accounts: RowAccount[];
  ctid: number | null;
  isLive: boolean;
}) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [orderFilters, setOrderFilters] = useState<FilterState>(() => loadFilter(true));
  const patchOrderFilters = useCallback((pn: FilterPatch) => {
    setOrderFilters((s) => {
      const next = { ...s, ...pn };
      saveFilter(true, next);
      return next;
    });
  }, []);

  const syms = useMemo(() => uniqueSymbols(rows), [rows]);

  const orderTypeOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.orderType))).sort(),
    [rows]
  );

  const shownOrders = useMemo(() => applyFilter(rows, orderFilters), [rows, orderFilters]);
  const sortedOrders = useMemo(
    () => sortRows(shownOrders, orderFilters.sortKey, orderFilters.sortAsc),
    [shownOrders, orderFilters.sortKey, orderFilters.sortAsc]
  );
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      if (mode === "combined") {
        const settled = await Promise.all(
          accounts.map(async (a) => {
            try {
              const { orders } = await api.orders(a.ctid);
              const acct: RowAccount = { ctid: a.ctid, login: a.login, isLive: a.isLive, nickname: a.nickname };
              return orders.map((o) => ({ ...o, account: acct })) as OrderRow[];
            } catch {
              return null;
            }
          })
        );
        const merged = settled.flat().filter((b): b is OrderRow => b !== null);
        setRows(merged);
        setError(null);
      } else if (ctid != null) {
        const { orders } = await api.orders(ctid);
        setRows(orders);
        setError(null);
      }
      setLastUpdated(Date.now());
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err.message || "Failed to load orders");
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

  const envTag = isLive ? "LIVE" : "DEMO";
  const combined = mode === "combined";

  return (
    <div className="panel">
      <div className="panel-head">
        {combined ? (
          <span className="env-tag env-all">ALL</span>
        ) : (
          <span className={`env-tag ${isLive ? "env-live" : "env-demo"}`}>{envTag}</span>
        )}
        <span className="panel-count">{sortedOrders.length} pending</span>
        <span className="panel-meta">{lastUpdated ? `updated ${new Date(lastUpdated).toLocaleTimeString()}` : ""}</span>
        <button className="ghost small" onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      <FilterBar
        mode={mode}
        orders
        positions={false}
        state={orderFilters}
        onChange={patchOrderFilters}
        symbols={syms}
        orderTypes={orderTypeOptions}
      />

      {error && <div className="error-banner">{error}</div>}

      {sortedOrders.length === 0 && !loading ? (
        <div className="table-empty">No pending orders.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {combined && <SortTh label="Account" k="account" state={orderFilters} onPatch={patchOrderFilters} />}
              <SortTh label="Symbol" k="symbol" state={orderFilters} onPatch={patchOrderFilters} />
              <SortTh label="Side" k="side" state={orderFilters} onPatch={patchOrderFilters} />
              <SortTh label="Type" k="orderType" state={orderFilters} onPatch={patchOrderFilters} />
              <SortTh label="Level" k="price" state={orderFilters} onPatch={patchOrderFilters} />
              <SortTh label="Lots" k="lots" state={orderFilters} onPatch={patchOrderFilters} />
              <SortTh label="SL" k="stopLoss" state={orderFilters} onPatch={patchOrderFilters} />
              <SortTh label="TP" k="takeProfit" state={orderFilters} onPatch={patchOrderFilters} />
            </tr>
          </thead>
          <tbody>
            {sortedOrders.map((o) => (
              <tr key={combined && o.account ? `${o.account.ctid}:${o.orderId}` : o.orderId}>
                {combined && o.account && AccountCell(o.account)}
                <td className="mono">{o.symbol}</td>
                <td className={o.side === "BUY" ? "side-buy" : "side-sell"}>{o.side}</td>
                <td>{orderTypeLabel(o.orderType)}</td>
                <td className="num">{fmtPrice(o.price, o.digits)}</td>
                <td className="num">{fmtLots(o.lots)}</td>
                <td className="num">{fmtPrice(o.stopLoss, o.digits)}</td>
                <td className="num">{fmtPrice(o.takeProfit, o.digits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
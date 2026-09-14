import { useEffect, useState } from "react";
import { api, AccountView, ConnectInput, RowAccount } from "./api";
import ConnectPanel from "./ConnectPanel";
import SettingsPage from "./Settings";
import PositionsTab from "./PositionsTab";
import OrdersTab from "./OrdersTab";

export type ViewMode = "separate" | "combined";
const MODE_KEY = "doochyweb_mode";

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [selectedCtid, setSelectedCtid] = useState<number | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [mode, setMode] = useState<ViewMode>(() =>
    localStorage.getItem(MODE_KEY) === "combined" ? "combined" : "separate"
  );

  function switchMode(next: ViewMode) {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  }

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ hasCredentials, accounts }) => {
        if (!alive) return;
        setHasCredentials(hasCredentials);
        setAccounts(accounts);
        if (!selectedCtid && accounts.length > 0) {
          const preferred = accounts.find((a) => a.isLive) ?? accounts[0];
          setSelectedCtid(preferred.ctid);
        }
      })
      .catch(() => setHasCredentials(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshBalances() {
    setBalanceLoading(true);
    try {
      const { accounts: fresh } = await api.accounts();
      setAccounts(fresh);
    } finally {
      setBalanceLoading(false);
    }
  }

  async function handleConnected(creds: ConnectInput) {
    const { accounts: fresh } = await api.connect(creds);
    setHasCredentials(true);
    setShowConnect(false);
    const preferred = fresh.find((a) => a.isLive) ?? fresh[0];
    setAccounts(fresh);
    if (preferred) setSelectedCtid(preferred.ctid);
    refreshBalances();
  }

  const selected = accounts.find((a) => a.ctid === selectedCtid) ?? null;
  const demoAccounts = accounts.filter((a) => !a.isLive);
  const liveAccounts = accounts.filter((a) => a.isLive);

  if (hasCredentials === null) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (showSettings) {
    return (
      <SettingsPage
        accounts={accounts}
        onAccountsChanged={setAccounts}
        onConnected={handleConnected}
        onClose={() => setShowSettings(false)}
      />
    );
  }

  if (showConnect) {
    return (
      <ConnectPanel
        onConnected={handleConnected}
        onCancel={hasCredentials ? () => setShowConnect(false) : undefined}
      />
    );
  }

  if (!hasCredentials) {
    return <ConnectPanel onConnected={handleConnected} />;
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">DoochyWeb</div>
        <div className="topbar-actions">
          <button className="ghost" onClick={refreshBalances} disabled={balanceLoading}>
            {balanceLoading ? "…" : "Refresh balances"}
          </button>
          <button
            className="ghost gear-btn"
            aria-label="Settings"
            title="Settings"
            onClick={() => setShowSettings(true)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82h0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="account-bar">
        <label htmlFor="account-select">Account</label>
        <select
          id="account-select"
          value={mode === "combined" ? "" : selectedCtid ?? ""}
          disabled={mode === "combined"}
          onChange={(e) => setSelectedCtid(Number(e.target.value))}
        >
          {mode === "combined" && <option value="">All accounts</option>}
          <optgroup label="Live">
            {liveAccounts.map((a) => (
              <option key={a.ctid} value={a.ctid}>
                {a.login} · {a.broker}
                {a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Demo">
            {demoAccounts.map((a) => (
              <option key={a.ctid} value={a.ctid}>
                {a.login} · {a.broker}
                {a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : ""}
              </option>
            ))}
          </optgroup>
          {accounts.length === 0 && <option value="">No accounts</option>}
        </select>
        <label className="mode-toggle" title="Show all accounts together">
          <span className="mode-toggle-label">Combined</span>
          <input
            className="mode-toggle-input"
            type="checkbox"
            checked={mode === "combined"}
            onChange={(e) => switchMode(e.target.checked ? "combined" : "separate")}
          />
          <span className="mode-toggle-track" aria-hidden="true">
            <span className="mode-toggle-thumb" />
          </span>
        </label>
      </section>

      {(mode === "combined" && accounts.length > 0) || selected ? (
        <main className="tabs">
          <Tabs mode={mode} accounts={accounts} ctid={selected?.ctid ?? null} isLive={selected?.isLive ?? false} />
        </main>
      ) : (
        <div className="empty-state">
          No cTrader accounts found. Check your credentials.
        </div>
      )}
    </div>
  );
}

function Tabs({
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
  const [tab, setTab] = useState<"positions" | "orders">("positions");
  return (
    <>
      <div className="tabbar">
        <button className={tab === "positions" ? "tab active" : "tab"} onClick={() => setTab("positions")}>
          Positions
        </button>
        <button className={tab === "orders" ? "tab active" : "tab"} onClick={() => setTab("orders")}>
          Pending Orders
        </button>
      </div>
      {tab === "positions" ? (
        <PositionsTab mode={mode} accounts={accounts} ctid={ctid} isLive={isLive} />
      ) : (
        <OrdersTab mode={mode} accounts={accounts} ctid={ctid} isLive={isLive} />
      )}
    </>
  );
}

// Combined-mode row identity: which account a position/order came from. Shows
// the nickname when one is set; un-nicknamed accounts get the login number plus
// a LIVE/DEMO tag so the row's environment is never ambiguous.
export function AccountCell(acct: RowAccount) {
  const unnamed = !acct.nickname;
  return (
    <td className="acct-cell">
      <span className="mono">{unnamed ? acct.login : acct.nickname}</span>
      {unnamed && <span className={`env-tag ${acct.isLive ? "env-live" : "env-demo"}`}>{acct.isLive ? "LIVE" : "DEMO"}</span>}
    </td>
  );
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPrice(n: number | null | undefined, digits?: number): string {
  if (n == null || Number.isNaN(n)) return "—";
  // Scale decimals to the magnitude of the price so big values don't show
  // long trailing zeros (e.g. 75,000.000), while tiny ones keep precision.
  const cap = n >= 1_000 ? 2 : n >= 100 ? 3 : 4;
  const d = Math.min(digits ?? cap, cap, 5);
  return n.toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function fmtLots(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}
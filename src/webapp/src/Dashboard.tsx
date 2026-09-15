import { useEffect, useState } from "react";
import { ChevronDown, LogOut, RefreshCw, Settings } from "lucide-react";
import { api, AccountView, ConnectInput } from "./api";
import ConnectPanel from "./ConnectPanel";
import SettingsPage from "./Settings";
import PositionsTab from "./PositionsTab";
import OrdersTab from "./OrdersTab";
import { Button, Card, Toggle } from "./components/ui";
import { FadeRise } from "./components/motion";

export type ViewMode = "separate" | "combined";
const MODE_KEY = "doochyweb_mode";

const PAGES = [
  { key: "positions", label: "Positions" },
  { key: "orders", label: "Pending orders" },
] as const;

type PageKey = (typeof PAGES)[number]["key"];

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
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3">
          <div className="h-32 w-full animate-pulse rounded-lg bg-surface-hover" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-surface-hover" />
        </div>
      </div>
    );
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
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="text-base font-semibold tracking-tight">DoochyWeb</div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCw className="h-4 w-4" />}
              onClickAsync={refreshBalances}
              aria-label="Refresh balances"
              title="Refresh balances"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Settings className="h-4 w-4" />}
              onClick={() => setShowSettings(true)}
              aria-label="Settings"
              title="Settings"
            />
            <Button size="sm" variant="ghost" icon={<LogOut className="h-4 w-4" />} onClick={onLogout} aria-label="Sign out" title="Sign out">
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <FadeRise>
          <div className="space-y-6">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-sm font-medium text-fg-muted">Account</span>
                  <div className="relative min-w-0 flex-1">
                    <select
                      id="account-select"
                      value={mode === "combined" ? "" : selectedCtid ?? ""}
                      disabled={mode === "combined"}
                      onChange={(e) => setSelectedCtid(Number(e.target.value))}
                      className="w-full appearance-none rounded-md border border-hairline bg-surface py-2 pl-3 pr-8 text-sm font-medium text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
                    >
                      {mode === "combined" && <option value="">All accounts</option>}
                      {liveAccounts.length > 0 && (
                        <option value="__live" disabled>
                          Live
                        </option>
                      )}
                      {liveAccounts.map((a) => (
                        <option key={a.ctid} value={a.ctid}>
                          {a.login} · {a.broker}
                          {a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : ""}
                        </option>
                      ))}
                      {demoAccounts.length > 0 && (
                        <option value="__demo" disabled>
                          Demo
                        </option>
                      )}
                      {demoAccounts.map((a) => (
                        <option key={a.ctid} value={a.ctid}>
                          {a.login} · {a.broker}
                          {a.balance != null ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}` : ""}
                        </option>
                      ))}
                      {accounts.length === 0 && <option value="">No accounts</option>}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                  </div>
                </div>
                <Toggle label="Combined" checked={mode === "combined"} onToggle={(c) => switchMode(c ? "combined" : "separate")} />
              </div>
            </Card>

            {(mode === "combined" && accounts.length > 0) || selected ? (
              <Tabs mode={mode} accounts={accounts} ctid={selected?.ctid ?? null} isLive={selected?.isLive ?? false} />
            ) : (
              <Card className="p-8 text-center">
                <div className="text-sm text-fg-muted">No cTrader accounts found.</div>
                <div className="mt-1 text-xs text-fg-faint">Check your credentials.</div>
              </Card>
            )}
          </div>
        </FadeRise>
      </main>
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
  const [tab, setTab] = useState<PageKey>("positions");
  return (
    <div className="space-y-5">
      <div className="flex gap-1">
        {PAGES.map((p) => (
          <button
            key={p.key}
            onClick={() => setTab(p.key)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition " +
              (tab === p.key
                ? "border border-accent/20 bg-accent-soft text-accent"
                : "border border-transparent text-fg-muted hover:bg-surface-hover hover:text-fg")
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      {tab === "positions" ? (
        <PositionsTab mode={mode} accounts={accounts} ctid={ctid} isLive={isLive} />
      ) : (
        <OrdersTab mode={mode} accounts={accounts} ctid={ctid} isLive={isLive} />
      )}
    </div>
  );
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPrice(n: number | null | undefined, digits?: number): string {
  if (n == null || Number.isNaN(n)) return "-";
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
  if (n == null || Number.isNaN(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function fmtTime(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
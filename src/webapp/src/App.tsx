import { useState } from "react";
import { api, getToken, setToken, type ConnectInput } from "./api";
import AnalysisPage from "./market/AnalysisPage";
import AppShell, { type ViewKey } from "./AppShell";
import ConnectPanel from "./ConnectPanel";
import Dashboard from "./Dashboard";
import Login from "./Login";
import SettingsPage from "./Settings";
import { useAccounts } from "./useAccounts";
import { Skeleton } from "./components/ui";

// The Analysis page is public: market quotes and the shared watchlist carry no
// account data, so a visitor can use it without an account. The Trading tab
// holds cTrader credentials, positions and orders, so it stays behind auth.
export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [booting, setBooting] = useState<boolean>(() => !!getToken());
  const [view, setView] = useState<ViewKey>("analysis");
  const [showSettings, setShowSettings] = useState(false);
  const signedIn = !!token;
  const { accounts, setAccounts, hasCredentials, load, refreshBalances, connect } =
    useAccounts(signedIn);

  // Validate a stored token once on load; drop it if it expired.
  if (booting && token) {
    return (
      <BootstrapGate
        token={token}
        onValid={() => setBooting(false)}
        onInvalid={() => {
          setToken(null);
          setTokenState(null);
          setBooting(false);
        }}
      />
    );
  }

  async function handleConnected(creds: ConnectInput) {
    await connect(creds);
    await refreshBalances();
  }

  function handleAuthed(t: string) {
    setToken(t);
    setTokenState(t);
  }

  function handleLogout() {
    setToken(null);
    setTokenState(null);
    setShowSettings(false);
    setView("analysis");
  }

  // Settings manages cTrader credentials, so it is a takeover for signed-in
  // users only and sits outside the shell.
  if (showSettings && signedIn) {
    return (
      <SettingsPage
        accounts={accounts}
        onAccountsChanged={setAccounts}
        onConnected={handleConnected}
        onClose={() => {
          setShowSettings(false);
          void load();
        }}
      />
    );
  }

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      onRefresh={signedIn ? refreshBalances : undefined}
      signedIn={signedIn}
      onOpenSettings={() => setShowSettings(true)}
      onSignIn={() => setView("trading")}
      onLogout={handleLogout}
    >
      {view === "analysis" ? (
        <AnalysisPage canWrite={signedIn} />
      ) : !signedIn ? (
        <div className="flex justify-center py-8">
          <Login
            variant="inline"
            onAuthed={handleAuthed}
            hint="Sign in to view and manage your cTrader accounts. Market analysis above is public."
          />
        </div>
      ) : hasCredentials === null ? (
        <div className="mx-auto w-full max-w-sm space-y-3 py-8">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !hasCredentials ? (
        <ConnectPanel onConnected={handleConnected} />
      ) : (
        <Dashboard accounts={accounts} />
      )}
    </AppShell>
  );
}

// Rendered instead of the shell only while a stored token is being verified.
function BootstrapGate({
  token,
  onValid,
  onInvalid,
}: {
  token: string;
  onValid: () => void;
  onInvalid: () => void;
}) {
  useState(() => {
    api
      .me(token)
      .then(onValid)
      .catch(onInvalid);
  });
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

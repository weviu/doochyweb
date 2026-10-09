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

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [booting, setBooting] = useState<boolean>(() => !!getToken());

  // Validate the stored token once on load; if it expired we fall back to login.
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

  if (!token) {
    return (
      <Login
        onAuthed={(t) => {
          setToken(t);
          setTokenState(t);
        }}
      />
    );
  }

  return (
    <AuthedApp
      onLogout={() => {
        setToken(null);
        setTokenState(null);
      }}
    />
  );
}

// Credential entry and settings are full-screen takeovers that sit outside the
// shell, so they are routed here rather than inside either view.
function AuthedApp({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<ViewKey>("analysis");
  const [showSettings, setShowSettings] = useState(false);
  const { accounts, setAccounts, hasCredentials, load, refreshBalances, connect } = useAccounts();

  async function handleConnected(creds: ConnectInput) {
    await connect(creds);
    await refreshBalances();
  }

  if (hasCredentials === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  if (!hasCredentials) {
    return <ConnectPanel onConnected={handleConnected} />;
  }

  if (showSettings) {
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
      onRefresh={view === "trading" ? refreshBalances : undefined}
      onOpenSettings={() => setShowSettings(true)}
      onLogout={onLogout}
    >
      {view === "trading" ? (
        <Dashboard accounts={accounts} />
      ) : (
        <AnalysisPage />
      )}
    </AppShell>
  );
}

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
import { useEffect, useState } from "react";
import { api, ApiError, AccountView, ConnectInput } from "./api";
import ConnectPanel from "./ConnectPanel";
import { fmtMoney } from "./Dashboard";

export default function SettingsPage({
  accounts,
  onConnected,
  onAccountsChanged,
  onClose,
}: {
  accounts: AccountView[];
  onConnected: (creds: ConnectInput) => Promise<void>;
  onAccountsChanged: (accounts: AccountView[]) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(accounts.map((a) => [a.ctid, a.nickname ?? ""]))
  );
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showConnect, setShowConnect] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries(accounts.map((a) => [a.ctid, a.nickname ?? ""])));
  }, [accounts]);

  async function saveNickname(ctid: number) {
    setSaving(ctid);
    setSaveError(null);
    try {
      const nickname = (drafts[ctid] ?? "").trim();
      await api.setNickname(ctid, nickname);
      const { accounts: fresh } = await api.accounts();
      onAccountsChanged(fresh);
    } catch (err: any) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save nickname");
    } finally {
      setSaving(null);
    }
  }

  if (showConnect) {
    return (
      <ConnectPanel
        onConnected={async (creds) => {
          await onConnected(creds);
          const { accounts: fresh } = await api.accounts();
          onAccountsChanged(fresh);
          setShowConnect(false);
        }}
        onCancel={() => setShowConnect(false)}
      />
    );
  }

  return (
    <div className="dashboard">
      <header className="topbar">
        <div className="brand">DoochyWeb</div>
        <div className="topbar-actions">
          <button className="ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </header>

      <main className="settings-body">
        <section className="settings-panel">
          <h1 className="settings-title">Settings</h1>

          <h2 className="settings-subtitle">Account nicknames</h2>
          <p className="settings-helper">
            Nicknames live on your side only; they are never sent to cTrader.
            Each account can have its own name so you can tell them apart in
            the account list.
          </p>
          {saveError && <div className="error-banner">{saveError}</div>}

          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Nickname</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.ctid}>
                  <td className="mono">
                    {a.login} · {a.broker}
                    {a.balance != null
                      ? ` · ${fmtMoney(a.balance)} ${a.currency ?? ""}`
                      : ""}
                  </td>
                  <td>
                    <input
                      className="nickname-input"
                      value={drafts[a.ctid] ?? ""}
                      maxLength={40}
                      placeholder="e.g. Main"
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [a.ctid]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="num">
                    <button
                      className="ghost small"
                      onClick={() => saveNickname(a.ctid)}
                      disabled={saving === a.ctid}
                    >
                      {saving === a.ctid ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="settings-panel">
          <h2 className="settings-subtitle">Credentials</h2>
          <p className="settings-helper">
            Manage the cTrader OpenAPI credentials used to fetch balances,
            positions and orders.
          </p>
          <button className="ghost" onClick={() => setShowConnect(true)}>
            Update credentials
          </button>
        </section>
      </main>
    </div>
  );
}

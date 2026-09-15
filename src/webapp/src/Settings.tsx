import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, KeyRound, Save } from "lucide-react";
import { api, ApiError, AccountView, ConnectInput } from "./api";
import ConnectPanel from "./ConnectPanel";
import { fmtMoney } from "./Dashboard";
import { Button, Card, inputCls } from "./components/ui";
import { FadeRise } from "./components/motion";

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
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-1 px-4">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft className="h-4 w-4" />}
            onClick={onClose}
            aria-label="Back"
          />
          <div className="flex items-center gap-2">
            <div className="text-[15px] font-semibold tracking-tight text-fg">DoochyWeb</div>
            <span className="mt-0.5 rounded bg-surface px-1 py-px text-[11px] font-medium text-fg-faint">settings</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <FadeRise>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-fg">Settings</h1>
            <p className="text-sm text-fg-muted">Manage how accounts appear and how DoochyWeb connects.</p>
          </div>
        </FadeRise>

        {saveError && (
          <Card className="border-danger/30 bg-danger-soft p-4">
            <div className="flex items-center gap-2 text-sm text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" /> {saveError}
            </div>
          </Card>
        )}

        <FadeRise>
          <Card className="p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Account nicknames</h2>
              <p className="text-sm text-fg-muted">
                Nicknames live on your side only; they are never sent to cTrader. Each account can have its own name so
                you can tell them apart in the account list and on positions and orders.
              </p>
            </div>
            <div className="mt-3 divide-y divide-hairline">
              {accounts.map((a) => {
                const draft = drafts[a.ctid] ?? "";
                const dirty = draft !== (a.nickname ?? "");
                return (
                  <div key={a.ctid} className="flex items-center gap-3 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            a.isLive
                              ? "bg-accent-soft text-accent"
                              : "bg-surface-active text-fg-muted"
                          }`}
                        >
                          {a.isLive ? "LIVE" : "DEMO"}
                        </span>
                        <span className="truncate text-sm font-medium tabular-nums text-fg">{a.login}</span>
                        <span className="truncate text-xs text-fg-faint">{a.broker}</span>
                      </div>
                      <div className="mt-0.5 text-xs tabular-nums text-fg-muted">
                        {a.balance != null ? `${fmtMoney(a.balance)} ${a.currency ?? ""}` : "- balance"}
                      </div>
                    </div>
                    <div className="w-44 shrink-0">
                      <input
                        className={inputCls}
                        value={draft}
                        maxLength={40}
                        placeholder="e.g. Main"
                        onChange={(e) => setDrafts((d) => ({ ...d, [a.ctid]: e.target.value }))}
                      />
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      variant={dirty ? "primary" : "secondary"}
                      icon={<Save className="h-3.5 w-3.5" />}
                      disabled={!dirty}
                      onClickAsync={dirty ? () => saveNickname(a.ctid) : undefined}
                    >
                      {saving === a.ctid ? "Saving…" : "Save"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        </FadeRise>

        <FadeRise>
          <Card className="p-4">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold tracking-tight text-fg">Credentials</h2>
              <p className="text-sm text-fg-muted">
                Manage the cTrader OpenAPI credentials used to fetch balances, positions and orders.
              </p>
            </div>
            <div className="mt-3">
              <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => setShowConnect(true)}>
                Update credentials
              </Button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-fg-faint">
              The server keeps a live-token version of these credentials inside ~/.doochyweb. Reconnecting renews it;
              there is nothing else to manage here.
            </p>
          </Card>
        </FadeRise>
      </main>
    </div>
  );
}
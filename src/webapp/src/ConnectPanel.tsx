import { FormEvent, useState } from "react";
import { ApiError, ConnectInput } from "./api";

const HELPER_TEXT = `Paste the four values from your cTrader OpenAPI app:
Client ID and Client Secret: openapi.ctrader.com/apps → your app → "Credentials"
Access and Refresh tokens:openapi.ctrader.com/apps →  your app  → sandbox  → set scope to
Account info and trading and generate tokens`;

export default function ConnectPanel({
  onConnected,
  onCancel,
}: {
  onConnected: (creds: ConnectInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onConnected({ clientId, clientSecret, accessToken, refreshToken });
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Connect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-screen">
      <form className="connect-card" onSubmit={submit}>
        <h1>Connect cTrader</h1>
        <p className="connect-helper">{HELPER_TEXT}</p>

        <label htmlFor="clientId">CLIENT_ID</label>
        <input id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />

        <label htmlFor="clientSecret">CLIENT_SECRET</label>
        <input
          id="clientSecret"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          autoComplete="off"
        />

        <label htmlFor="accessToken">ACCESS_TOKEN</label>
        <input id="accessToken" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} autoComplete="off" />

        <label htmlFor="refreshToken">REFRESH_TOKEN</label>
        <input id="refreshToken" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} autoComplete="off" />

        {error && <div className="error-banner">{error}</div>}

        <div className="connect-actions">
          <button className="primary" disabled={busy || !clientId || !clientSecret || !accessToken || !refreshToken}>
            {busy ? "Connecting…" : "Connect"}
          </button>
          {onCancel && (
            <button type="button" className="ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
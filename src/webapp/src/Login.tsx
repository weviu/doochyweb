import { FormEvent, useState } from "react";
import { api, ApiError } from "./api";

export default function Login({ onAuthed }: { onAuthed: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      onAuthed(res.token);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>DoochyWeb</h1>
        <p className="auth-subtitle">
          {mode === "login" ? "Sign in to manage your cTrader accounts" : "Create an account to get started"}
        </p>

        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />

        {error && <div className="error-banner">{error}</div>}

        <button className="primary" disabled={busy || !username || !password}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>

        <p className="auth-toggle">
          {mode === "login" ? (
            <button type="button" className="link" onClick={() => setMode("register")}>
              No account? Register
            </button>
          ) : (
            <button type="button" className="link" onClick={() => setMode("login")}>
              Already registered? Sign in
            </button>
          )}
        </p>
      </form>
    </div>
  );
}
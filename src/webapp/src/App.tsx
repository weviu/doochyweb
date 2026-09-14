import { useState } from "react";
import { api, getToken, setToken } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";

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
    <Dashboard
      onLogout={() => {
        setToken(null);
        setTokenState(null);
      }}
    />
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
  return <div className="loading-screen">Loading…</div>;
}
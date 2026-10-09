import { useCallback, useEffect, useState } from "react";

import { api, type AccountView, type ConnectInput } from "./api";

// Account state is shared by the trading view and the Settings takeover, so it
// lives here rather than inside either component. Created once by App and
// passed down.

export function useAccounts() {
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.me();
      setHasCredentials(res.hasCredentials);
      setAccounts(res.accounts);
      return res.accounts;
    } catch {
      setHasCredentials(false);
      return [];
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read balances + broker names without touching the credential state. */
  const refreshBalances = useCallback(async () => {
    try {
      const { accounts: fresh } = await api.accounts();
      setAccounts(fresh);
    } catch {
      /* leave the previous balances on screen */
    }
  }, []);

  /** Validate a credential set, persist it, and adopt the discovered accounts. */
  const connect = useCallback(async (creds: ConnectInput) => {
    const { accounts: fresh } = await api.connect(creds);
    setHasCredentials(true);
    setAccounts(fresh);
    return fresh;
  }, []);

  return { accounts, setAccounts, hasCredentials, load, refreshBalances, connect };
}
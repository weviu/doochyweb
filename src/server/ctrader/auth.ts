import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { ENV_HOST, PORT, REQUEST_TIMEOUT_MS, isTokenError } from "./connection";
import { StoredAccount } from "../db";

export interface DiscoveredTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

function installRequestTimeout(connection: any): void {
  const raw = connection.sendCommand.bind(connection);
  connection.sendCommand = (name: string, data?: any, id?: any) => {
    const p = raw(name, data, id);
    if (!/req$/i.test(name)) return p;
    return Promise.race([
      p,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error(`cTrader request timed out: ${name}`)), REQUEST_TIMEOUT_MS)
      ),
    ]);
  };
}

async function doRefresh(connection: any, refreshToken: string): Promise<DiscoveredTokens> {
  const res = await connection.sendCommand("ProtoOARefreshTokenReq", { refreshToken });
  const accessToken = res?.accessToken;
  const newRefreshToken = res?.refreshToken;
  if (!accessToken || !newRefreshToken) throw new Error("Refresh response missing tokens");
  return { accessToken, refreshToken: newRefreshToken, expiresInSec: Number(res?.expiresIn) || 0 };
}

function mapAccounts(list: any[]): StoredAccount[] {
  return (list || []).map((a: any) => ({
    ctid: Number(a.ctidTraderAccountId),
    login: Number(a.traderLogin) || 0,
    broker: String(a.brokerName ?? "unknown broker"),
    isLive: a.isLive === true || a.isLive === "true",
  }));
}

// Validate a user-entered credential set against the broker and discover every
// account under the grant (demo and live together — the account-list call is
// made on the demo endpoint and answers for live accounts too). Returns the
// discovered accounts plus any rotated tokens. Uses its own short-lived socket
// so a failed validation leaves nothing half-open in the pool.
export async function discoverAccounts(input: {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}): Promise<{ accounts: StoredAccount[]; tokens: DiscoveredTokens }> {
  const connection = new CTraderConnection({ host: ENV_HOST.demo, port: PORT });
  let tokens: DiscoveredTokens = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresInSec: 0,
  };
  try {
    await Promise.race([
      connection.open(),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("cTrader socket open timed out")), REQUEST_TIMEOUT_MS)
      ),
    ]);
    installRequestTimeout(connection);
    await connection.sendCommand("ProtoOAApplicationAuthReq", {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    });
    const listOnce = () =>
      connection.sendCommand("ProtoOAGetAccountListByAccessTokenReq", { accessToken: tokens.accessToken });
    try {
      const res = await listOnce();
      return { accounts: mapAccounts(res?.ctidTraderAccount), tokens };
    } catch (err: any) {
      if (!isTokenError(err) || !tokens.refreshToken) throw err;
      tokens = await doRefresh(connection, tokens.refreshToken);
      const res = await listOnce();
      return { accounts: mapAccounts(res?.ctidTraderAccount), tokens };
    }
  } finally {
    try { connection.close?.(); } catch { /* ignore */ }
  }
}
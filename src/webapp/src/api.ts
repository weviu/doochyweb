const TOKEN_KEY = "doochyweb_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = opts.token ?? getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError("Network error — is the server running?", 0);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export interface AccountView {
  ctid: number;
  login: number;
  broker: string;
  isLive: boolean;
  balance: number | null;
  currency: string | null;
  nickname: string | null;
}

// Account carried on a row when its data is shown in combined mode, so the
// table can say which account a position/order belongs to.
export interface RowAccount {
  ctid: number;
  login: number;
  isLive: boolean;
  nickname: string | null;
}

export interface PositionRow {
  positionId: number;
  symbol: string;
  side: "BUY" | "SELL";
  lots: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  netUsd: number | null;
  digits: number;
  openTimestamp: number | null;
  account?: RowAccount;
}

export interface OrderRow {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  price: number;
  lots: number;
  stopLoss: number | null;
  takeProfit: number | null;
  digits: number;
  expirationTimestamp: number | null;
  expirationType: "GTC" | "GTD";
  account?: RowAccount;
}

export interface ConnectInput {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}

export const api = {
  register: (username: string, password: string) =>
    request<{ token: string }>("/api/auth/register", { method: "POST", body: { username, password } }),

  login: (username: string, password: string) =>
    request<{ token: string }>("/api/auth/login", { method: "POST", body: { username, password } }),

  me: (token?: string) =>
    request<{ hasCredentials: boolean; accounts: AccountView[] }>("/api/me", { token }),

  connect: (creds: ConnectInput, token?: string) =>
    request<{ accounts: AccountView[] }>("/api/connect", { method: "POST", body: creds, token }),

  accounts: () => request<{ accounts: AccountView[] }>("/api/accounts"),

  positions: (ctid: number) => request<{ positions: PositionRow[] }>(`/api/accounts/${ctid}/positions`),

  orders: (ctid: number) => request<{ orders: OrderRow[] }>(`/api/accounts/${ctid}/orders`),

  setNickname: (ctid: number, nickname: string, token?: string) =>
    request<{ ok: boolean }>(`/api/accounts/${ctid}/nickname`, {
      method: "PUT",
      body: { nickname },
      token,
    }),
};
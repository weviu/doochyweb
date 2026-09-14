import { CTraderConnection } from "@reiryoku/ctrader-layer";
import { loadCredentials, saveCredentials } from "../db";

// Per-user, per-environment socket pool. One process-level map of UserSockets,
// each holding at most two CTraderConnection instances (one demo, one live).
// Accounts are scoped on a shared socket via ProtoOAAccountAuthReq, so two
// sockets per user is the hard ceiling regardless of how many accounts they have.

export type CtraderEnv = "demo" | "live";

export const ENV_HOST: Record<CtraderEnv, string> = {
  demo: "demo.ctraderapi.com",
  live: "live.ctraderapi.com",
};
export const PORT = 5035;
export const REQUEST_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 10_000;
const IDLE_MS = 15 * 60_000;

// Spot events carry integer prices scaled by 10^5 (e.g. 1.36350 -> 136350).
const SPOT_SCALE = 100_000;

export interface SpotQuote {
  bid: number;
  ask: number;
  time: number;
}

// Broker error codes a fresh access token can fix. Exact-match allowlist: a
// refresh ROTATES the token and invalidates it for every other connection under
// the grant, so we must never refresh on an error a new token cannot fix.
export const TOKEN_ERROR_CODES = new Set([
  "CH_ACCESS_TOKEN_INVALID",
  "ACCESS_TOKEN_EXPIRED",
  "OA_AUTH_TOKEN_EXPIRED",
  "CH_EXPIRED_ACCESS_TOKEN",
  "INVALID_REQUEST",
]);

export function isTokenError(err: any): boolean {
  return !!err && TOKEN_ERROR_CODES.has(String(err?.errorCode ?? "").toUpperCase());
}

// The layer has no request timeout and its socket close/error handlers are
// no-ops, so a silently dropped TCP link would leave every await pending
// forever. Wrap "*.Req" calls with a race against a timeout; events resolve
// synchronously and must not be guarded.
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

function timeoutError(message: string): Promise<never> {
  return new Promise((_resolve, reject) => setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS));
}

// One broker socket for one environment, authenticated at the app level. Sends
// are serialized through a promise queue so concurrent sends never interleave a
// half-encoded frame. Heartbeats every 10s to keep the push channel alive.
class Channel {
  readonly env: CtraderEnv;
  private conn: CTraderConnection | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private heartbeat: NodeJS.Timeout | null = null;
  private closedFlag = true;
  lastUsedAt = Date.now();
  authedAccounts = new Set<number>();
  // Symbols the broker is streaming spots for on this socket. Reset on reopen
  // (a fresh socket forgets every subscription). Quotes are keyed by symbolId.
  subscribedSpots = new Set<number>();
  lastQuotes = new Map<number, SpotQuote>();

  constructor(env: CtraderEnv) {
    this.env = env;
  }

  get healthy(): boolean {
    return !!this.conn && !this.closedFlag;
  }

  async open(clientId: string, clientSecret: string): Promise<void> {
    const previous = this.conn;
    this.conn = null;
    this.closedFlag = true;
    try { previous?.close?.(); } catch { /* ignore */ }

    const connection = new CTraderConnection({ host: ENV_HOST[this.env], port: PORT });
    await Promise.race([connection.open(), timeoutError("cTrader socket open timed out")]);
    installRequestTimeout(connection);
    await connection.sendCommand("ProtoOAApplicationAuthReq", { clientId, clientSecret });

    // A reconnect is a brand-new broker session: spot subscriptions are
    // forgotten server-side and quote history is stale. Clear before the first
    // ProtoOASpotEvent on the new socket.
    this.subscribedSpots.clear();
    this.lastQuotes.clear();
    connection.on("ProtoOASpotEvent", (event: any) => this.onSpotEvent(event));

    this.conn = connection;
    this.closedFlag = false;
    this.authedAccounts.clear();
    this.lastUsedAt = Date.now();

    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      try {
        connection.sendHeartbeat();
        this.lastUsedAt = Date.now();
      } catch {
        // Dead socket; next request reopens the channel.
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  send(name: string, data?: any): Promise<any> {
    const conn = this.conn;
    if (!conn || this.closedFlag) return Promise.reject(new Error("cTrader channel not open"));
    this.lastUsedAt = Date.now();
    const run = this.queue.then(() => conn.sendCommand(name, data));
    this.queue = run.catch(() => {});
    return run;
  }

  // Keep the newest bid/ask per symbolId. Spot events only carry whichever side
  // moved; preserve the other side from the previous quote.
  private onSpotEvent(event: any): void {
    const data = event?.descriptor ?? event;
    const symId = Number(data?.symbolId);
    if (!symId) return;
    const prev = this.lastQuotes.get(symId) ?? { bid: 0, ask: 0, time: 0 };
    const bid = data.bid != null ? Number(data.bid) / SPOT_SCALE : prev.bid;
    const ask = data.ask != null ? Number(data.ask) / SPOT_SCALE : prev.ask;
    this.lastQuotes.set(symId, { bid: bid || 0, ask: ask || 0, time: Date.now() });
    this.lastUsedAt = Date.now();
  }

  // Request spot streaming for symbols not yet subscribed on this socket.
  // ALREADY_SUBSCRIBED from the broker is treated as success: it means the
  // stream is already flowing, so we just remember we asked.
  async subscribeSpots(ctid: number, symbolIds: number[]): Promise<void> {
    const fresh = [...new Set(symbolIds.filter((id) => id && !this.subscribedSpots.has(id)))];
    if (!fresh.length) return;
    try {
      await this.send("ProtoOASubscribeSpotsReq", { ctidTraderAccountId: ctid, symbolId: fresh });
    } catch (err: any) {
      const code = String(err?.errorCode ?? "").toUpperCase();
      if (code !== "ALREADY_SUBSCRIBED") throw err;
    }
    fresh.forEach((id) => this.subscribedSpots.add(id));
  }

  getQuote(symId: number): SpotQuote | null {
    return this.lastQuotes.get(symId) ?? null;
  }

  close(): void {
    this.closedFlag = true;
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    try { this.conn?.close?.(); } catch { /* ignore */ }
    this.conn = null;
    this.authedAccounts.clear();
    this.subscribedSpots.clear();
    this.lastQuotes.clear();
  }
}

export class UserSockets {
  readonly userId: string;
  private demo: Channel | null = null;
  private live: Channel | null = null;
  private rotating: Promise<void> | null = null;
  // Single-flight: at most one socket open in flight per env, so concurrent
  // callers never race open() and orphan a second socket per environment.
  private demoOpening: Promise<Channel> | null = null;
  private liveOpening: Promise<Channel> | null = null;

  constructor(userId: string) {
    this.userId = userId;
  }

  idleMs(): number {
    const times = [this.demo?.lastUsedAt, this.live?.lastUsedAt].filter((t): t is number => !!t);
    return times.length ? Date.now() - Math.max(...times) : Infinity;
  }

  private async creds() {
    const c = await loadCredentials(this.userId);
    if (!c) throw new Error("No cTrader credentials stored for this user");
    return c;
  }

  private async channel(env: CtraderEnv): Promise<Channel> {
    const opening = env === "demo" ? this.demoOpening : this.liveOpening;
    if (opening) return opening;
    const current = env === "demo" ? this.demo : this.live;
    if (current?.healthy) return current;
    const job = this.openChannel(env).finally(() => {
      if (env === "demo") this.demoOpening = null; else this.liveOpening = null;
    });
    if (env === "demo") this.demoOpening = job; else this.liveOpening = job;
    return job;
  }

  private async openChannel(env: CtraderEnv): Promise<Channel> {
    const c = await this.creds();
    // Re-check after the await: a concurrent caller may have opened it already.
    let ch = env === "demo" ? this.demo : this.live;
    if (ch?.healthy) return ch;
    ch?.close();
    ch = new Channel(env);
    await ch.open(c.clientId, c.clientSecret);
    if (env === "demo") this.demo = ch; else this.live = ch;
    return ch;
  }

  async warm(env: CtraderEnv): Promise<void> {
    // Best-effort: opening a socket must not fail an HTTP request that has
    // already succeeded (e.g. /api/connect). Lazy channel() covers the gap.
    try { await this.channel(env); } catch { /* ignore */ }
  }

  // Read channel state without opening a socket (used to read cached quotes;
  // opening just to peek would defeat the point of the cache).
  private channelOrNull(env: CtraderEnv): Channel | null {
    const ch = env === "demo" ? this.demo : this.live;
    return ch?.healthy ? ch : null;
  }

  // Make the broker stream spots for the given symbolIds on this user's env
  // socket. Idempotent; safe to call on every poll.
  async ensureSpots(env: CtraderEnv, ctid: number, symbolIds: number[]): Promise<void> {
    const ch = await this.channel(env);
    const fresh = [...new Set(symbolIds.filter((id) => id && !ch.subscribedSpots.has(id)))];
    if (!fresh.length) return;
    try {
      await this.send(env, "ProtoOASubscribeSpotsReq", { ctidTraderAccountId: ctid, symbolId: fresh }, { ctid });
    } catch (err: any) {
      const code = String(err?.errorCode ?? "").toUpperCase();
      if (code !== "ALREADY_SUBSCRIBED") throw err;
    }
    // A token rotation reopens the socket (new Channel object); mark the ids on
    // whichever channel is live now.
    const live = (env === "demo" ? this.demo : this.live) ?? ch;
    fresh.forEach((id) => live.subscribedSpots.add(id));
  }

  // Latest cached bid/ask for a symbol, or null if no quote has arrived yet.
  getQuote(env: CtraderEnv, symId: number): SpotQuote | null {
    return this.channelOrNull(env)?.getQuote(symId) ?? null;
  }

  private closeChannels(): void {
    this.demo?.close();
    this.demo = null;
    this.demoOpening = null;
    this.live?.close();
    this.live = null;
    this.liveOpening = null;
  }

  close(): void {
    this.closeChannels();
    this.rotating = null;
  }

  // Send on an environment's socket. If the broker rejects with a token error,
  // rotate the tokens (closing both sockets), then retry once on a fresh
  // channel. Account-scoped requests re-auth the account post-rotation.
  async send(env: CtraderEnv, name: string, data?: any, opts?: { ctid?: number }): Promise<any> {
    try {
      if (opts?.ctid != null) await this.ensureAccountAuthed(env, opts.ctid);
      const ch = await this.channel(env);
      return await ch.send(name, data);
    } catch (err: any) {
      if (!isTokenError(err)) throw err;
      await this.rotateTokens();
      if (opts?.ctid != null) await this.ensureAccountAuthed(env, opts.ctid);
      const ch = await this.channel(env);
      return await ch.send(name, data);
    }
  }

  async ensureAccountAuthed(env: CtraderEnv, ctid: number): Promise<void> {
    const ch = await this.channel(env);
    if (ch.authedAccounts.has(ctid)) return;
    try {
      await ch.send("ProtoOAAccountAuthReq", {
        ctidTraderAccountId: ctid,
        accessToken: (await this.creds()).accessToken,
      });
      ch.authedAccounts.add(ctid);
    } catch (err: any) {
      if (String(err?.errorCode ?? "").toUpperCase() === "ALREADY_LOGGED_IN") {
        // Two recovery paths racing for one account: the session already
        // exists. This is success, not error.
        ch.authedAccounts.add(ctid);
        return;
      }
      if (isTokenError(err)) {
        await this.rotateTokens();
        await this.ensureAccountAuthed(env, ctid);
        return;
      }
      throw err;
    }
  }

  // Refresh tokens are single-use and ROTATE. Persist the rotated pair back to
  // Mongo on every refresh (single-flight), or the next login breaks when the
  // old refresh token dies. Closing both sockets invalidates old sessions; the
  // next request opens fresh ones authenticated with the new token.
  async rotateTokens(): Promise<void> {
    if (this.rotating) {
      await this.rotating;
      return;
    }
    const job = this.doRotate().finally(() => { this.rotating = null; });
    this.rotating = job;
    await job;
  }

  private async doRotate(): Promise<void> {
    const c = await this.creds();
    if (!c.refreshToken) throw new Error("No refresh token stored; auto-recovery unavailable");
    const ch = await this.channel("demo");
    const res = await ch.send("ProtoOARefreshTokenReq", { refreshToken: c.refreshToken });
    const accessToken = res?.accessToken;
    const refreshToken = res?.refreshToken;
    if (!accessToken || !refreshToken) throw new Error("Refresh response missing tokens");
    await saveCredentials(this.userId, {
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      accessToken,
      refreshToken,
      accounts: c.accounts,
    });
    this.closeChannels();
  }
}

const pools = new Map<string, UserSockets>();

export function userSockets(userId: string): UserSockets {
  let s = pools.get(userId);
  if (!s) {
    s = new UserSockets(userId);
    pools.set(userId, s);
  }
  return s;
}

export function dropUserSockets(userId: string): void {
  pools.get(userId)?.close();
  pools.delete(userId);
}

// Close sockets after a long idle window so a user who stopped polling does not
// hold broker connections forever.
const sweep = setInterval(() => {
  for (const [userId, s] of pools) {
    if (s.idleMs() > IDLE_MS) {
      s.close();
      pools.delete(userId);
    }
  }
}, 60_000);
sweep.unref?.();
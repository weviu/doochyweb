// Tiny fetch helpers shared by every provider. Uses global fetch (Node 18+)
// with an abort-based timeout so a slow upstream can never hang a request.
// Ported from the standalone `gauge` project.

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export interface FetchOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { headers = {}, timeout = 12000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers,
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Upstream APIs explain themselves in the error body: Twelve Data, for
      // one, says "this symbol is available starting with the Grow or Venture
      // plan" on a 404. Without that the user only sees a bare status code.
      const detail = extractErrorDetail(text);
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Pull a short human-readable reason out of an error body: the `message` field
// when the body is JSON, otherwise a trimmed prefix of the raw text. HTML is
// stripped, because some upstreams answer errors with a challenge/landing page
// (Stooq returns a 403 interstitial) and dumping markup into the UI helps
// nobody.
function extractErrorDetail(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as { message?: unknown; error?: unknown };
      const msg = j.message ?? j.error;
      if (typeof msg === "string" && msg.trim()) return msg.trim().slice(0, 200);
    } catch {
      /* not JSON after all */
    }
  }
  const asText = trimmed.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return asText.slice(0, 120);
}

export async function fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Upstream returned invalid JSON");
  }
}
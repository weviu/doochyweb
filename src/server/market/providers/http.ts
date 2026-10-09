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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = unknown>(url: string, options?: FetchOptions): Promise<T> {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Upstream returned invalid JSON");
  }
}
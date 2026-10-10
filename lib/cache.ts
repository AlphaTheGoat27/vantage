import { SNAPSHOTS } from "./snapshots";

// Small in-memory TTL cache for upstream APIs. Keeps the last good value when a refresh
// fails, and shares one in-flight request between concurrent callers.
type Entry<T> = { value?: T; at: number; inflight?: Promise<T> };
const store = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const e = store.get(key) as Entry<T> | undefined;
  const now = Date.now();
  if (e?.value !== undefined && now - e.at < ttlMs) return e.value;
  if (e?.inflight) return e.inflight;
  const p = load()
    .then((v) => {
      store.set(key, { value: v, at: Date.now() });
      return v;
    })
    .catch((err) => {
      if (e?.value !== undefined) {
        store.set(key, { value: e.value, at: e.at });
        return e.value;
      }
      store.delete(key);
      throw err;
    });
  store.set(key, { ...(e ?? { at: 0 }), inflight: p });
  return p;
}

// ---- last-good snapshots bundled in the repo (lib/data/snapshots/*.json, refreshed by scripts/snapshot-sources.mts) ----
const fallbackUsed = new Map<string, string>();

/** cached() that falls back to the bundled snapshot when the upstream is down and nothing is in memory. */
export async function resilient<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  try {
    const v = await cached(key, ttlMs, load);
    fallbackUsed.delete(key);
    return v;
  } catch (err) {
    const snap = SNAPSHOTS[key];
    if (!snap || snap.data == null) throw err;
    fallbackUsed.set(key, snap.takenAt);
    return snap.data as T;
  }
}
/** Last good in-memory value for a cache key (used by scripts/snapshot-sources.mts). */
export const peek = (key: string) => (store.get(key) as Entry<unknown> | undefined)?.value;
export const fallbackInfo = (keys: string[]) => keys.map((k) => fallbackUsed.get(k)).find(Boolean);

export async function fetchJson<T = unknown>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(init?.timeoutMs ?? 15000),
    headers: { "user-agent": "Vantage/0.1 (hackathon maritime risk demo)", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return (await res.json()) as T;
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "Mozilla/5.0 (compatible; Vantage/0.1)" },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.text();
}

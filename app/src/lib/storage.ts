// localStorage that never throws (private mode, quota, disabled storage).
// Keys shared with the legacy page (same origin, so people carry over):
//   trip.key      share key (X-Trip-Key)
//   trip.me       current person id
//   trip.pending  offline write queue (same format as legacy)
//   trip.got      expanded «Куплено» groups (section names, "\u0000extra")
//   trip.tab      last tab: "exp" | "sum" (absent = list)
// New-app only:
//   trip.next.snap  data snapshot for instant/offline start

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

export const LS: KV = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

export function readJSON<T>(kv: KV, key: string, fallback: T): T {
  const raw = kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** In-memory KV for tests. */
export function memoryKV(init: Record<string, string> = {}): KV & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => {
      if (v == null) data.delete(k);
      else data.set(k, v);
    },
  };
}

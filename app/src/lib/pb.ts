// PocketBase client and the trip key.
//
// There is no login: reads are public, writes carry the shared trip key in
// X-Trip-Key. The key comes from the share link https://<site>/#<key> (old
// form #k=<key>), is remembered in localStorage "trip.key" (shared with the
// legacy page) and never leaves the phone except in that header.

import PocketBase, { ClientResponseError } from "pocketbase";
import { LS } from "./storage";

const SERVER = "https://trip-api.svorobovich.com";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

function apiUrl(): string {
  const env = import.meta.env.VITE_PB_URL as string | undefined;
  if (env) return env;
  // Dev/preview proxy /api to a local PocketBase; a page served by PocketBase
  // itself also talks to its own origin.
  if (import.meta.env.DEV || LOCAL.test(location.hostname)) return location.origin;
  return SERVER;
}

export const KEY_RE = /^[A-Za-z0-9_-]{12,64}$/;

/** Reads #<key> / #k=<key> from the URL, stores it, and clears the hash. */
function initKey(): string | null {
  const m = location.hash.match(/^#(?:k=)?([A-Za-z0-9_-]{12,64})$/);
  if (m?.[1]) {
    LS.set("trip.key", m[1]);
    // Keep the key out of the address bar (screenshots, re-shares).
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      /* ignore */
    }
  }
  const k = LS.get("trip.key");
  return k && KEY_RE.test(k) ? k : null;
}

export const TRIP_KEY: string | null = initKey();

// A share link opened while the page is already open only changes the hash.
addEventListener("hashchange", () => {
  const m = location.hash.match(/^#(?:k=)?([A-Za-z0-9_-]{12,64})$/);
  if (m?.[1] && m[1] !== TRIP_KEY) {
    LS.set("trip.key", m[1]);
    location.replace(location.pathname + location.search);
  }
});
export const canWriteKey = TRIP_KEY !== null;

export const pb = new PocketBase(apiUrl());
pb.autoCancellation(false);
pb.beforeSend = (url, options) => {
  if (TRIP_KEY) options.headers = { ...(options.headers as Record<string, string>), "X-Trip-Key": TRIP_KEY };
  return { url, options };
};

/** Share link for the group: always the site root, so it works for both apps. */
export function shareUrl(): string | null {
  return TRIP_KEY ? `${location.origin}/#${TRIP_KEY}` : null;
}

/**
 * "Try again later" errors: no network, aborted, or a 5xx from the tunnel /
 * proxy (PocketBase down or restarting: Cloudflare answers 502/530). Queued
 * writes stay queued for these; 4xx (bad key, validation) are final.
 */
export function isNetErr(e: unknown): boolean {
  if (!e) return true;
  const err = e as { status?: number; isAbort?: boolean; name?: string };
  if (e instanceof ClientResponseError) return e.status === 0 || e.isAbort || e.status >= 500;
  return err.status === 0 || (err.status ?? 0) >= 500 || !!err.isAbort || err.name === "TypeError" || err.name === "AbortError";
}

export function errMsg(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if ((status === 403 || status === 404) && TRIP_KEY) return "ключ не подошёл, попроси новую ссылку";
  if (status === 403) return "нужна ссылка с ключом";
  return (e as { message?: string } | null)?.message || "ошибка";
}

// After «Перевести» (Revolut) or «BLIK» the person leaves for another app.
// When the page is visible again within 10 minutes, Итоги asks once whether
// to mark the transfer. The tap is kept in localStorage ("trip.payTap"), so
// the question also comes if iOS reloaded the page while it was away.
import { useEffect, useRef } from "react";
import { LS, readJSON } from "../../lib/storage";

export interface PayTap {
  from: string;
  to: string;
  /** grosze */
  g: number;
  /** Date.now() of the tap */
  at: number;
}

const KEY = "trip.payTap";
export const PAY_RETURN_MS = 10 * 60 * 1000;

export function notePayTap(t: Omit<PayTap, "at">): void {
  LS.set(KEY, JSON.stringify({ ...t, at: Date.now() }));
}

/** The pending tap if still fresh; clears it either way. */
function takeTap(now = Date.now()): PayTap | null {
  const t = readJSON<PayTap | null>(LS, KEY, null);
  if (!t) return null;
  LS.set(KEY, null);
  const ok = typeof t.from === "string" && typeof t.to === "string" && Number.isInteger(t.g) && typeof t.at === "number";
  return ok && now - t.at >= 0 && now - t.at <= PAY_RETURN_MS ? t : null;
}

/** Calls `onReturn(tap)` when the page comes back after a tap (or loads with a fresh one). */
export function usePayReturn(onReturn: (t: PayTap) => void): void {
  const cb = useRef(onReturn);
  cb.current = onReturn;
  useEffect(() => {
    let away = false;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        if (LS.get(KEY)) away = true;
        return;
      }
      if (!away) return;
      away = false;
      // let the page settle (realtime catch-up) before asking
      setTimeout(() => {
        const t = takeTap();
        if (t) cb.current(t);
      }, 400);
    };
    const t = takeTap();
    if (t) cb.current(t);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
}

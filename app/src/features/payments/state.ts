// UI state of the payments tab: the payment sheet and the receipt viewer.
// Other features may call openPayment(id) to show a payment.

import { createStore, dataStore, useStore } from "../../lib/stores";
import { canWriteKey } from "../../lib/pb";
import type { Expense } from "../../lib/types";

export type PayView = "edit" | "details";

export interface PayUi {
  open: boolean;
  /** expense id; null = a new payment */
  id: string | null;
  view: PayView;
  /** a photo picked on the tab before the sheet opened (new payments) */
  file: File | null;
  /** focus the amount (manual entry) */
  manual: boolean;
  /** bumps on every open, so the form starts fresh */
  seq: number;
}

export const payUi = createStore<PayUi>({ open: false, id: null, view: "edit", file: null, manual: false, seq: 0 });
export const usePayUi = <U>(sel: (s: PayUi) => U): U => useStore(payUi, sel);

/** Opens with the details (lines, claims) when there is something to show, else the editor. */
export const hasDetails = (x: Expense): boolean =>
  x.split_mode === "claims" || (Array.isArray(x.lines) && x.lines.some((l) => l && l.text));

export function openNewPayment(opts: { file?: File | null; manual?: boolean } = {}): void {
  payUi.set((s) => ({ open: true, id: null, view: "edit", file: opts.file ?? null, manual: !!opts.manual, seq: s.seq + 1 }));
}

export function openPayment(id: string, view?: PayView): void {
  const x = dataStore.get().expenses.get(id);
  if (!x) return;
  const v = view ?? (hasDetails(x) || !canWriteKey ? "details" : "edit");
  payUi.set((s) => ({ open: true, id, view: v, file: null, manual: false, seq: s.seq + 1 }));
}

export const setPayView = (view: PayView) => payUi.set((s) => ({ ...s, view }));
export const closePayment = () => payUi.set((s) => (s.open ? { ...s, open: false, file: null } : s));

// ---------- receipt viewer ----------

export interface ViewerState {
  src: string;
  title: string;
  meta: string;
}
export const viewerUi = createStore<ViewerState | null>(null);
export const useViewer = () => useStore(viewerUi, (s) => s);

/** Images open in the viewer; PDFs in a new tab. */
export function openViewer(v: ViewerState & { pdf?: boolean }): void {
  if (v.pdf) {
    window.open(v.src, "_blank", "noopener");
    return;
  }
  viewerUi.set({ src: v.src, title: v.title, meta: v.meta });
}
export const closeViewer = () => viewerUi.set(null);

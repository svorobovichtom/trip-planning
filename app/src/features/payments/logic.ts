// Pure logic of the payments tab: the form (validation, «Суммами»
// reconciliation, the payload that is sent), scan status, receipt lines
// grouped for display and claiming. No React, no network — see logic.test.ts.

import { byOrder, linesOk, receiptRows, splitEven } from "../../lib/ledger";
import { grosze, parseAmount, parseG } from "../../lib/money";
import { lineQty } from "../../lib/receipt";
import { CATEGORIES, type Expense, type ReceiptLine, type SplitMode } from "../../lib/types";
import { SCANNABLE_NAME, SCANNABLE_TYPE } from "../../lib/image";

export type Mode = Exclude<SplitMode, "">;

/** 5034 -> "50,34" (input value) */
export const g2s = (g: number): string => (g / 100).toFixed(2).replace(".", ",");
/** Keeps what can be part of an amount while typing. */
export const cleanAmountInput = (s: string): string => s.replace(/[^\d.,\s]/g, "");

export const isScanning = (x: Pick<Expense, "scan_status"> | null | undefined): boolean =>
  !!x && (x.scan_status === "pending" || x.scan_status === "running");

const pad2 = (n: number) => String(n).padStart(2, "0");
export const dayStr = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const parseDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---------- scan status ----------

export type ScanView =
  | { kind: "scanning" }
  | { kind: "failed"; retry: boolean }
  | { kind: "mismatch" }
  /** an image receipt that was never read (old payments) */
  | { kind: "unread" }
  | { kind: "ok"; lines: number }
  | { kind: "none" };

export const lineCount = (x: Pick<Expense, "lines">): number =>
  Array.isArray(x.lines) ? x.lines.filter((l) => l && l.text).length : 0;

export function scanView(x: Expense): ScanView {
  if (isScanning(x)) return { kind: "scanning" };
  if (x.scan_status === "failed") return { kind: "failed", retry: x.scan_error !== "unsupported_format" };
  const n = lineCount(x);
  if (n && x.scan_error === "lines_mismatch") return { kind: "mismatch" };
  if (n) return { kind: "ok", lines: n };
  if (x.receipt && SCANNABLE_NAME.test(x.receipt)) return { kind: "unread" };
  return { kind: "none" };
}

/** «поровну на 8» / «суммами» / «по чеку» */
export function splitLabel(x: Expense, order: readonly string[]): string {
  if (x.split_mode === "amounts" && x.split_amounts && Object.keys(x.split_amounts).length) return "суммами";
  if (x.split_mode === "claims" && linesOk(x)) return "по чеку";
  const n = byOrder(x.split_between ?? [], order).length || order.length;
  return `поровну на ${n}`;
}

// ---------- «Суммами» ----------

export interface AmountsState {
  /** participants in list order */
  ids: string[];
  /** sum of the typed amounts, grosze */
  fixed: number;
  /** the amount being split (typed, or the typed parts when there is no total) */
  total: number;
  /** total − fixed */
  rem: number;
  /** participants left on «авто» (empty input) */
  autos: string[];
  /** what each «авто» gets */
  auto: Map<string, number>;
  /** ids with an unparsable amount */
  bad: string[];
  /** why it can't be saved, "" = fine */
  err: string;
}

/**
 * `amountG` is the typed total (0 = none). `photo` = a readable receipt will
 * fill the total later. Without both, the total is what is written down.
 */
export function amountsState(ids: readonly string[], amts: Readonly<Record<string, string>>, amountG: number, photo: boolean): AmountsState {
  let fixed = 0;
  const autos: string[] = [];
  const bad: string[] = [];
  for (const id of ids) {
    const v = (amts[id] ?? "").trim();
    if (!v) {
      autos.push(id);
      continue;
    }
    const n = parseG(v);
    if (Number.isNaN(n)) bad.push(id);
    else fixed += n;
  }
  const total = amountG || (!photo && !autos.length ? fixed : 0);
  const rem = total - fixed;
  const auto = new Map<string, number>();
  if (total && rem > 0) splitEven(rem, autos, auto);
  for (const id of autos) if (!auto.has(id)) auto.set(id, 0);
  let err = "";
  if (!ids.length) err = "Отметь, на кого делим";
  else if (bad.length) err = "Проверь суммы";
  else if (!total) {
    if (autos.length) err = photo ? "" : "Впиши сумму";
    else err = photo ? "Оставь кого-то на «авто» — сумма подставится из чека" : "Впиши суммы";
  } else if (rem < 0) err = `Расписано больше суммы на ${fmtPlain(-rem)}`;
  else if (rem > 0 && !autos.length) err = `Остаток ${fmtPlain(rem)} — допиши или оставь кого-то на «авто»`;
  return { ids: [...ids], fixed, total, rem, autos, auto, bad, err };
}

const fmtPlain = (g: number) => `${g2s(g)} zł`;

// ---------- the form ----------

export interface PayForm {
  amount: string;
  title: string;
  /** "" = none / «из чека» */
  cat: string;
  paid: string;
  mode: Mode;
  /** participants (any order; sorted by people order when used) */
  part: string[];
  /** «Суммами»: person -> typed amount, "" = «авто» */
  amts: Record<string, string>;
  /** YYYY-MM-DD */
  date: string;
  /** a new receipt (already compressed) */
  file: File | null;
  /** drop the saved receipt */
  removeFile: boolean;
  /** fields this person changed (the scan may fill the others meanwhile) */
  touched: { amount?: boolean; title?: boolean; cat?: boolean };
}

export function initialForm(x: Expense | null, me: string | null, order: readonly string[], today = new Date()): PayForm {
  const mode: Mode = x && (x.split_mode === "amounts" || x.split_mode === "claims") ? x.split_mode : "equal";
  let part = x ? byOrder(x.split_between ?? [], order) : [];
  if (!part.length) part = [...order];
  const amts: Record<string, string> = {};
  const sa = x?.split_amounts;
  if (x && x.split_mode === "amounts" && sa && typeof sa === "object") {
    const ids = byOrder(Object.keys(sa), order);
    if (ids.length) part = ids;
    for (const id of ids) {
      const v = sa[id];
      amts[id] = v == null ? "" : g2s(Number(v));
    }
  }
  const d = x ? parseDate(x.spent_at || x.created) : today;
  return {
    amount: x && x.amount > 0 ? g2s(grosze(x.amount)) : "",
    title: x?.title ?? "",
    cat: x?.category ?? "",
    paid: x?.paid_by || me || "",
    mode,
    part,
    amts,
    date: d ? dayStr(d) : "",
    file: null,
    removeFile: false,
    touched: {},
  };
}

/** Server values for the fields this person hasn't touched (scan finished, someone edited). */
export function syncUntouched(f: PayForm, x: Expense): PayForm {
  const next = { ...f };
  let changed = false;
  const amount = x.amount > 0 ? g2s(grosze(x.amount)) : "";
  if (!f.touched.amount && f.amount !== amount) {
    next.amount = amount;
    changed = true;
  }
  if (!f.touched.title && f.title !== (x.title ?? "")) {
    next.title = x.title ?? "";
    changed = true;
  }
  if (!f.touched.cat && f.cat !== (x.category ?? "")) {
    next.cat = x.category ?? "";
    changed = true;
  }
  return changed ? next : f;
}

/** Typed amount in grosze; 0 when empty or invalid. */
export function formAmountG(f: Pick<PayForm, "amount">): number {
  const v = parseAmount(f.amount);
  return v > 0 ? Math.round(v * 100) : 0;
}

/** There is (or will be) a receipt the server can read. */
export function readablePhoto(f: Pick<PayForm, "file" | "removeFile">, x: Expense | null): boolean {
  if (f.file) return SCANNABLE_TYPE.test(f.file.type);
  return !!x?.receipt && !f.removeFile && SCANNABLE_NAME.test(x.receipt);
}
export function hasPhoto(f: Pick<PayForm, "file" | "removeFile">, x: Expense | null): boolean {
  return !!f.file || (!!x?.receipt && !f.removeFile);
}

/** «По чеку» is offered only for a saved payment whose lines add up (and no new photo pending). */
export function claimsAvailable(f: Pick<PayForm, "file" | "removeFile">, x: Expense | null): boolean {
  return !!x && !f.file && !f.removeFile && linesOk(x);
}
/** Why «По чеку» is off. */
export function claimsHint(f: Pick<PayForm, "file" | "removeFile">, x: Expense | null): string {
  if (!hasPhoto(f, x)) return "Нужно фото чека: по нему каждый отметит, что брал";
  if (f.file || !x) return "Появится, когда чек распознается";
  if (isScanning(x)) return "Появится, когда чек распознается";
  if (x.scan_error === "lines_mismatch") return "Позиции неточные — не сходятся с суммой чека";
  if (x.scan_status === "failed") return "Чек не распознали — дели поровну или суммами";
  return lineCount(x) ? "Позиции неточные" : "Появится, когда чек распознается";
}

export interface SaveCtx {
  order: readonly string[];
  now?: Date;
}
export type SaveResult =
  | { ok: true; data: Record<string, unknown>; changed: boolean; dropClaims: boolean }
  | { ok: false; error: string; field?: "amount" | "amounts" | "paid" | "part" };

/** What to send. For edits only what changed, so values the scan filled meanwhile survive. */
export function buildSave(f: PayForm, x: Expense | null, ctx: SaveCtx): SaveResult {
  const { order } = ctx;
  const now = ctx.now ?? new Date();
  const raw = f.amount.trim();
  let amount = raw ? parseAmount(raw) : 0;
  if (raw && !(amount >= 0.01)) return { ok: false, error: "Проверь сумму", field: "amount" };
  if (amount > 1_000_000) return { ok: false, error: "Слишком большая сумма", field: "amount" };
  const readable = readablePhoto(f, x);
  // «По чеку» needs readable lines; a payment already split that way keeps it
  // (a new receipt resets it below).
  const mode: Mode = f.mode === "claims" && !claimsAvailable(f, x) && x?.split_mode !== "claims" ? "equal" : f.mode;
  const part = byOrder(f.part, order);
  const st = mode === "amounts" ? amountsState(part, f.amts, Math.round(amount * 100), readable) : null;
  if (st?.err) return { ok: false, error: st.err, field: "amounts" };
  let derived = false;
  if (!amount && st && st.total && !readable) {
    amount = st.total / 100;
    derived = true;
  }
  if (!amount && !readable && !(x && x.amount > 0 && !f.touched.amount)) {
    return { ok: false, error: hasPhoto(f, x) ? "Введи сумму" : "Добавь фото чека или введи сумму", field: "amount" };
  }
  // a saved payment whose amount is cleared would silently drop out of the
  // balances (the scan only fills an amount for a new receipt or a rescan)
  if (x && !amount && f.touched.amount && x.amount > 0 && !f.file && !isScanning(x)) {
    return { ok: false, error: "Введи сумму", field: "amount" };
  }
  if (!order.includes(f.paid)) return { ok: false, error: "Выбери, кто платил", field: "paid" };
  if (!part.length) return { ok: false, error: "Отметь, на кого делим", field: "part" };

  const splitBetween = part.length < order.length ? part : [];
  const splitAmounts = st
    ? Object.fromEntries(st.ids.map((id) => {
        const v = (f.amts[id] ?? "").trim();
        return [id, v ? parseG(v) : null];
      }))
    : null;
  const at = spentAt(f.date, x ? dayOf(x) : null, now);
  const title = f.title.trim().slice(0, 120);

  const data: Record<string, unknown> = {};
  if (!x) {
    Object.assign(data, {
      amount, title, category: f.cat, currency: "PLN", paid_by: f.paid,
      split_between: splitBetween, split_mode: mode, split_amounts: splitAmounts,
    });
  } else {
    if ((f.touched.amount || derived) && grosze(amount) !== grosze(x.amount)) data.amount = amount;
    if (f.touched.title && title !== (x.title ?? "")) data.title = title;
    if (f.touched.cat && f.cat !== (x.category ?? "")) data.category = f.cat;
    if (f.paid !== x.paid_by) data.paid_by = f.paid;
    if (!sameIds(splitBetween, byOrder(x.split_between ?? [], order).length < order.length ? byOrder(x.split_between ?? [], order) : [])) {
      data.split_between = splitBetween;
    }
    if (mode !== (x.split_mode || "equal")) data.split_mode = mode;
    if (JSON.stringify(splitAmounts) !== JSON.stringify(x.split_amounts ?? null)) data.split_amounts = splitAmounts;
  }
  if (at) data.spent_at = at;
  let dropClaims = false;
  if (f.file) {
    data.receipt = f.file;
    if (x) {
      // a new receipt: old lines and claims no longer apply; the scan starts over
      data.lines = null;
      data.scan_error = "";
      if (mode === "claims" || x.split_mode === "claims") data.split_mode = "equal";
      dropClaims = true;
    }
  } else if (x && f.removeFile && x.receipt) data.receipt = null;
  return { ok: true, data, changed: Object.keys(data).length > 0, dropClaims };
}

const dayOf = (x: Expense): string | null => {
  const d = parseDate(x.spent_at || x.created);
  return d ? dayStr(d) : null;
};

/** ISO date to store, or undefined when the day didn't change. Noon local time for past days. */
export function spentAt(v: string, orig: string | null, now: Date): string | undefined {
  if (orig !== null && v === orig) return undefined;
  if (!v || v === dayStr(now)) return now.toISOString();
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return now.toISOString();
  return new Date(y, m - 1, d, 12).toISOString();
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- receipt lines ----------

export interface LineRow {
  /** index in expense.lines (claims.line) */
  idx: number;
  /** discount lines folded into this one (their indices) */
  extra: number[];
  text: string;
  qty: string;
  /** price incl. folded discounts, grosze; null = unknown */
  g: number | null;
  /** folded discounts, grosze (negative) */
  discount: number;
  cat: string;
  itemId: string | null;
}

export interface LineGroup {
  cat: string;
  g: number;
  rows: LineRow[];
}

const OTHER = "Другое";

/**
 * Receipt lines for display and claiming: a discount line (negative price)
 * right after a product is folded into it, so «Помидоры −14» is one row;
 * grouped by category in the usual category order.
 */
export function groupLines(lines: readonly (ReceiptLine | null | undefined)[] | null | undefined): { groups: LineGroup[]; rows: LineRow[]; categorized: boolean } {
  // the same rows the ledger charges for (lib/ledger.ts receiptRows)
  const rows: LineRow[] = receiptRows(lines).map((r) => {
    const l = lines![r.idx]!;
    return {
      idx: r.idx, extra: r.extra, text: l.text, qty: lineQty(l), g: r.g, discount: r.discount,
      cat: l.category || "", itemId: l.item_id || null,
    };
  });
  const categorized = rows.some((r) => r.cat);
  const by = new Map<string, LineRow[]>();
  for (const r of rows) {
    const c = categorized ? r.cat || OTHER : "";
    let arr = by.get(c);
    if (!arr) by.set(c, (arr = []));
    arr.push(r);
  }
  const rank = (c: string) => {
    const i = (CATEGORIES as readonly string[]).indexOf(c);
    return c === OTHER ? 1000 : i >= 0 ? i : 500;
  };
  const groups = [...by.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([cat, rs]) => ({ cat, rows: rs, g: rs.reduce((s, r) => s + (r.g ?? 0), 0) }));
  return { groups, rows, categorized };
}

export interface ClaimProgress {
  /** claimed lines, grosze */
  got: number;
  /** the receipt amount (or the sum of lines) */
  all: number;
  /** participants who haven't claimed anything yet (list order) */
  waiting: string[];
}

export function claimProgress(x: Expense, rows: readonly LineRow[], byLine: Map<number, string[]> | undefined, participants: readonly string[]): ClaimProgress {
  let got = 0;
  let sum = 0;
  for (const r of rows) {
    sum += r.g ?? 0;
    if (byLine?.get(r.idx)?.length) got += r.g ?? 0;
  }
  const who = new Set<string>();
  if (byLine) for (const ids of byLine.values()) for (const id of ids) who.add(id);
  return { got, all: grosze(x.amount) || sum, waiting: participants.filter((id) => !who.has(id)) };
}

/** «ждём Ваню, Олю и ещё 3» */
export function waitingText(names: readonly string[]): string {
  if (!names.length) return "все отметились";
  if (names.length > 3) return `ждём ${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}`;
  return `ждём ${names.join(", ")}`;
}

/** List items matched by the scan that are not bought yet. */
export function unboughtMatches(x: Expense, isOpen: (itemId: string) => boolean): string[] {
  if (!Array.isArray(x.lines)) return [];
  const ids = new Set<string>();
  for (const l of x.lines) if (l && l.item_id && isOpen(l.item_id)) ids.add(l.item_id);
  return [...ids];
}

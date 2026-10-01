// Who owes whom. Pure functions over plain records; all amounts in grosze.
//
// Per expense (expenseShares):
//   equal   — the amount evenly between split_between (empty = everyone)
//   amounts — split_amounts {personId: grosze | null}: fixed shares, the rest
//             evenly between the «авто» (null) ones; nobody «авто» -> the rest
//             goes to split_between/everyone. Fixed shares that add up to MORE
//             than the amount (the scan filled a smaller total later) are
//             scaled down in proportion and «авто» get 0.
//   claims  — receipt rows (a discount line folded into the product above it,
//             exactly as the claims UI shows them — receiptRows) evenly
//             between the people who claimed the row; unclaimed rows +
//             (amount − sum of rows) evenly between split_between/everyone.
//             When the claimed rows alone are more than the amount, the
//             amount is split in proportion to what each person claimed.
//             Only when the lines add up (linesOk), otherwise it falls back
//             to equal.
// Every share is >= 0 and the shares add up to the amount exactly (if some
// share would still come out negative, e.g. someone claimed only a discount
// row, the amount is split in proportion to the positive shares instead).
// Rounding: leftover grosze go one each to the first people in list order
// (proportional splits: largest remainder first, ties in list order).
// Amount 0 (still being scanned) counts for nobody. Unknown person ids are
// ignored; an expense whose payer is unknown (deleted person) counts for
// nobody's balance, so the balances always add up to 0.
//
// Settlements (transfers marked «переведено», grosze) count like a payment
// between two people: bal[from] += g, bal[to] −= g. paid/owes stay trip
// spending; sent/received/settled show the transfers, so settle(bal) is
// what's left to transfer.

import { grosze } from "./money";
import type { Claim, Expense, Person, ReceiptLine, Settlement } from "./types";

export type Shares = Map<string, number>;

/** Adds `g` split evenly between `ids` (already in list order) into `into`. */
export function splitEven(g: number, ids: readonly string[], into: Shares): void {
  if (!ids.length || !g) return;
  const base = Math.floor(g / ids.length);
  const rem = g - base * ids.length;
  ids.forEach((id, i) => {
    into.set(id, (into.get(id) ?? 0) + base + (i < rem ? 1 : 0));
  });
}

/**
 * Adds `g` (>= 0) split in proportion to the positive values of `w` into
 * `into`: floor of each exact part, then the leftover grosze one each by
 * largest remainder (ties in `order`). False (nothing added) when no weight
 * is positive. Exact for any amount (BigInt).
 */
export function splitProp(g: number, w: ReadonlyMap<string, number>, order: readonly string[], into: Shares): boolean {
  const ids = byOrder([...w].filter(([, v]) => v > 0).map(([id]) => id), order);
  const W = ids.reduce((s, id) => s + BigInt(w.get(id)!), 0n);
  if (!W || g < 0) return false;
  const G = BigInt(g);
  const parts = ids.map((id, i) => {
    const num = G * BigInt(w.get(id)!);
    return { id, i, n: Number(num / W), f: num % W };
  });
  let left = g - parts.reduce((s, p) => s + p.n, 0);
  for (const p of [...parts].sort((a, b) => (b.f > a.f ? 1 : b.f < a.f ? -1 : a.i - b.i))) {
    if (left <= 0) break;
    p.n++;
    left--;
  }
  for (const p of parts) if (p.n) into.set(p.id, (into.get(p.id) ?? 0) + p.n);
  return true;
}

/** Unique known ids, sorted by people order. */
export function byOrder(ids: Iterable<string>, order: readonly string[]): string[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...new Set(ids)].filter((id) => pos.has(id)).sort((a, b) => pos.get(a)! - pos.get(b)!);
}

/** split_between in list order, or everyone when empty/unknown. */
export function participants(x: Pick<Expense, "split_between">, order: readonly string[]): string[] {
  const ids = byOrder(x.split_between ?? [], order);
  return ids.length ? ids : [...order];
}

/** Receipt lines can be split by claims only when the scan says they add up. */
export function linesOk(x: Pick<Expense, "lines" | "scan_error"> | null | undefined): boolean {
  return !!x && Array.isArray(x.lines) && x.lines.some((l) => l && l.text) && x.scan_error !== "lines_mismatch";
}

export interface ReceiptRow {
  /** index in expense.lines (what claims.line points at) */
  idx: number;
  /** discount lines folded into this row (their indices) */
  extra: number[];
  /** price incl. folded discounts, grosze; null = unknown price */
  g: number | null;
  /** folded discounts, grosze (<= 0) */
  discount: number;
}

/**
 * Receipt lines as claimable rows: a discount line (negative price) right
 * after a product with a known positive price is folded into it, so
 * «Помидоры 28,00 / Rabat −14,00» is one row worth 14,00. Only one discount
 * per row; a second one stays a row of its own. Lines without text are skipped.
 * The claims UI (groupLines) and the ledger both use this, so what a person
 * ticks is exactly what they pay for.
 */
export function receiptRows(lines: readonly (ReceiptLine | null | undefined)[] | null | undefined): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  (Array.isArray(lines) ? lines : []).forEach((l, idx) => {
    if (!l || !l.text) return;
    const g = l.price == null || !Number.isFinite(Number(l.price)) ? null : grosze(l.price);
    const prev = rows[rows.length - 1];
    if (g !== null && g < 0 && prev && prev.g !== null && prev.g > 0 && !prev.extra.length) {
      prev.extra.push(idx);
      prev.discount += g;
      prev.g += g;
      return;
    }
    rows.push({ idx, extra: [], g, discount: 0 });
  });
  return rows;
}

/** expense id -> line index -> claimer ids (list order). */
export type ClaimIndex = Map<string, Map<number, string[]>>;

export function indexClaims(claims: Iterable<Pick<Claim, "expense" | "line" | "person">>, order: readonly string[]): ClaimIndex {
  const raw = new Map<string, Map<number, string[]>>();
  for (const c of claims) {
    let byLine = raw.get(c.expense);
    if (!byLine) raw.set(c.expense, (byLine = new Map()));
    const arr = byLine.get(c.line);
    if (arr) arr.push(c.person);
    else byLine.set(c.line, [c.person]);
  }
  for (const byLine of raw.values()) for (const [i, ids] of byLine) byLine.set(i, byOrder(ids, order));
  return raw;
}

export function expenseShares(x: Expense, order: readonly string[], claims?: Map<number, string[]>): Shares {
  const g = grosze(x.amount);
  if (g <= 0 || !order.length) return new Map();
  const out = rawShares(x, g, order, claims);
  // never charge anyone a negative share: fall back to the positive parts
  if ([...out.values()].some((v) => v < 0)) {
    const fixed: Shares = new Map();
    if (!splitProp(g, out, order, fixed)) splitEven(g, participants(x, order), fixed);
    return fixed;
  }
  return out;
}

function rawShares(x: Expense, g: number, order: readonly string[], claims?: Map<number, string[]>): Shares {
  const out: Shares = new Map();
  const pool = participants(x, order);
  const sa = x.split_amounts;

  if (x.split_mode === "amounts" && sa && typeof sa === "object" && !Array.isArray(sa)) {
    const ids = byOrder(Object.keys(sa), order);
    if (ids.length) {
      let fixed = 0;
      const autos: string[] = [];
      for (const id of ids) {
        const v = sa[id] as unknown;
        if (v == null || v === "" || !Number.isFinite(Number(v))) autos.push(id);
        else {
          const n = Math.round(Number(v));
          fixed += n;
          out.set(id, (out.get(id) ?? 0) + n);
        }
      }
      if (fixed > g) {
        // written down more than the amount: everyone's fixed part shrinks in proportion
        const scaled: Shares = new Map();
        if (splitProp(g, out, order, scaled)) return scaled;
      }
      splitEven(g - fixed, autos.length ? autos : pool, out);
      return out;
    }
  } else if (x.split_mode === "claims" && linesOk(x)) {
    let claimed = 0;
    for (const r of receiptRows(x.lines)) {
      const who = claims?.get(r.idx);
      if (r.g && who && who.length) {
        splitEven(r.g, who, out);
        claimed += r.g;
      }
    }
    const rest = g - claimed;
    if (rest < 0) {
      // the claimed rows alone are more than the amount: split it in proportion
      const scaled: Shares = new Map();
      if (splitProp(g, out, order, scaled)) return scaled;
    }
    splitEven(rest, pool, out);
    return out;
  }
  splitEven(g, pool, out);
  return out;
}

/** How expenseShares actually split it (claims without readable lines and
 *  amounts without known people fall back to equal). */
export function splitModeOf(x: Expense, order: readonly string[]): "equal" | "amounts" | "claims" {
  const sa = x.split_amounts;
  if (x.split_mode === "amounts" && sa && typeof sa === "object" && !Array.isArray(sa) && byOrder(Object.keys(sa), order).length) return "amounts";
  if (x.split_mode === "claims" && linesOk(x)) return "claims";
  return "equal";
}

export const OTHER = "Другое";

/**
 * What an expense was spent on, by category; the parts add up to the amount.
 *   no receipt lines — all of it to the expense's category («Другое» if none)
 *   receipt lines    — each priced line to its category (a line without one
 *                      to the expense's category); a discount (negative line)
 *                      folds into the line above it; amount − sum(lines) to
 *                      the expense's category. When that doesn't work out
 *                      (lines add up to more than the amount, or a category
 *                      goes negative) the amount is spread in proportion to
 *                      the lines instead.
 */
export function expenseCats(x: Pick<Expense, "amount" | "category" | "lines">): Map<string, number> {
  const out = new Map<string, number>();
  const g = grosze(x.amount);
  if (!g) return out;
  const own = x.category || OTHER;
  const add = (m: Map<string, number>, c: string, v: number) => m.set(c, (m.get(c) ?? 0) + v);
  const byLine = new Map<string, number>();
  let prev: string | null = null;
  let sum = 0;
  for (const l of Array.isArray(x.lines) ? x.lines : []) {
    if (!l || !l.text) continue;
    const lg = grosze(l.price);
    if (!lg) continue;
    const c: string = lg < 0 && prev !== null ? prev : l.category || own;
    if (lg > 0) prev = c;
    add(byLine, c, lg);
    sum += lg;
  }
  if (!byLine.size) return out.set(own, g);
  const rest = g - sum;
  if (rest >= 0 && [...byLine.values()].every((v) => v >= 0)) {
    for (const [c, v] of byLine) if (v) add(out, c, v);
    if (rest) add(out, own, rest);
    return out;
  }
  // Proportional, largest remainder first so the parts add up exactly.
  const pos = [...byLine].filter(([, v]) => v > 0);
  const base = pos.reduce((s, [, v]) => s + v, 0);
  if (!base) return out.set(own, g);
  const parts = pos.map(([c, v], i) => {
    const exact = (g * v) / base;
    return { c, i, n: Math.floor(exact), f: exact - Math.floor(exact) };
  });
  let left = g - parts.reduce((s, p) => s + p.n, 0);
  for (const p of [...parts].sort((a, b) => b.f - a.f || a.i - b.i)) {
    if (left <= 0) break;
    p.n++;
    left--;
  }
  for (const p of parts) if (p.n) add(out, p.c, p.n);
  return out;
}

/** Categories biggest first (ties by name), zeros dropped. */
export function sortedCats(cats: Map<string, number>): [string, number][] {
  return [...cats].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
}

export interface Ledger {
  /** sum of all amounts */
  total: number;
  /** trip spending: what each person paid for expenses (transfers not included) */
  paid: Map<string, number>;
  /** trip spending: each person's share of the expenses */
  owes: Map<string, number>;
  /** money transfers marked as done («переведено»): sent / received per person */
  sent: Map<string, number>;
  received: Map<string, number>;
  /** sent − received */
  settled: Map<string, number>;
  /** paid − owes + settled: > 0 gets money back, < 0 owes; settle(bal) = what's left */
  bal: Map<string, number>;
  /** category -> total, from receipt lines when an expense has them (expenseCats) */
  cats: Map<string, number>;
  /** expense id -> shares */
  shares: Map<string, Shares>;
}

export function computeLedger(input: {
  people: readonly Pick<Person, "id">[];
  expenses: Iterable<Expense>;
  claims: Iterable<Pick<Claim, "expense" | "line" | "person">>;
  /** transfers between people, amount in grosze; count like a payment from → to */
  settlements?: Iterable<Pick<Settlement, "from" | "to" | "amount">>;
}): Ledger {
  const order = input.people.map((p) => p.id);
  const idx = indexClaims(input.claims, order);
  const paid = new Map(order.map((id) => [id, 0]));
  const owes = new Map(order.map((id) => [id, 0]));
  const cats = new Map<string, number>();
  const shares = new Map<string, Shares>();
  let total = 0;
  for (const x of input.expenses) {
    const g = grosze(x.amount);
    if (g <= 0) {
      shares.set(x.id, new Map());
      continue;
    }
    total += g;
    for (const [c, v] of expenseCats(x)) cats.set(c, (cats.get(c) ?? 0) + v);
    // a payer that isn't in the list (deleted) can't be paid back: the expense
    // counts for nobody's balance, so the balances still add up to 0
    const s = paid.has(x.paid_by) ? expenseShares(x, order, idx.get(x.id)) : new Map<string, number>();
    shares.set(x.id, s);
    if (!s.size) continue;
    paid.set(x.paid_by, paid.get(x.paid_by)! + g);
    for (const [id, v] of s) owes.set(id, owes.get(id)! + v);
  }
  const sent = new Map(order.map((id) => [id, 0]));
  const received = new Map(order.map((id) => [id, 0]));
  for (const t of input.settlements ?? []) {
    const g = Math.round(Number(t.amount));
    // unknown people, self-transfers and junk amounts count for nothing
    if (!Number.isFinite(g) || g <= 0 || t.from === t.to || !sent.has(t.from) || !received.has(t.to)) continue;
    sent.set(t.from, sent.get(t.from)! + g);
    received.set(t.to, received.get(t.to)! + g);
  }
  const settled = new Map(order.map((id) => [id, sent.get(id)! - received.get(id)!]));
  const bal = new Map(order.map((id) => [id, paid.get(id)! - owes.get(id)! + settled.get(id)!]));
  return { total, paid, owes, sent, received, settled, bal, cats, shares };
}

export interface Transfer {
  from: string;
  to: string;
  g: number;
}

/** Greedy settle-up: the biggest debtor pays the biggest creditor until square. */
export function settle(bal: Map<string, number>): Transfer[] {
  const cred: [string, number][] = [];
  const debt: [string, number][] = [];
  for (const [id, b] of bal) {
    if (b > 0) cred.push([id, b]);
    else if (b < 0) debt.push([id, -b]);
  }
  cred.sort((a, b) => b[1] - a[1]);
  debt.sort((a, b) => b[1] - a[1]);
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const d = debt[i]!;
    const c = cred[j]!;
    const amt = Math.min(d[1], c[1]);
    if (amt > 0) out.push({ from: d[0], to: c[0], g: amt });
    d[1] -= amt;
    c[1] -= amt;
    if (!d[1]) i++;
    if (!c[1]) j++;
  }
  return out;
}

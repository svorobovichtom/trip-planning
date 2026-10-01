// Who owes whom. Pure functions over plain records; all amounts in grosze.
//
// Per expense (expenseShares):
//   equal   — the amount evenly between split_between (empty = everyone)
//   amounts — split_amounts {personId: grosze | null}: fixed shares, the rest
//             evenly between the «авто» (null) ones; nobody «авто» -> the rest
//             goes to split_between/everyone
//   claims  — each receipt line evenly between the people who claimed it;
//             unclaimed lines + (amount − sum of lines) evenly between
//             split_between/everyone. Only when the lines add up (linesOk),
//             otherwise it falls back to equal.
// Rounding: leftover grosze go one each to the first people in list order,
// so the parts always add up to the amount exactly. Amount 0 (still being
// scanned) counts for nobody. Unknown person ids are ignored.

import { grosze } from "./money";
import type { Claim, Expense, Person } from "./types";

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
  const out: Shares = new Map();
  const g = grosze(x.amount);
  if (!g || !order.length) return out;
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
      splitEven(g - fixed, autos.length ? autos : pool, out);
      return out;
    }
  } else if (x.split_mode === "claims" && linesOk(x)) {
    let sum = 0;
    let rest = 0;
    (x.lines ?? []).forEach((l, i) => {
      if (!l || !l.text) return;
      const lg = grosze(l.price);
      sum += lg;
      const who = claims?.get(i);
      if (who && who.length) splitEven(lg, who, out);
      else rest += lg;
    });
    splitEven(rest + g - sum, pool, out);
    return out;
  }
  splitEven(g, pool, out);
  return out;
}

export interface Ledger {
  /** sum of all amounts */
  total: number;
  paid: Map<string, number>;
  owes: Map<string, number>;
  /** paid − owes: > 0 gets money back, < 0 owes */
  bal: Map<string, number>;
  /** category ("Другое" when empty) -> total */
  cats: Map<string, number>;
  /** expense id -> shares */
  shares: Map<string, Shares>;
}

export function computeLedger(input: {
  people: readonly Pick<Person, "id">[];
  expenses: Iterable<Expense>;
  claims: Iterable<Pick<Claim, "expense" | "line" | "person">>;
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
    total += g;
    const cat = x.category || "Другое";
    cats.set(cat, (cats.get(cat) ?? 0) + g);
    if (paid.has(x.paid_by)) paid.set(x.paid_by, paid.get(x.paid_by)! + g);
    const s = expenseShares(x, order, idx.get(x.id));
    shares.set(x.id, s);
    for (const [id, v] of s) if (owes.has(id)) owes.set(id, owes.get(id)! + v);
  }
  const bal = new Map(order.map((id) => [id, paid.get(id)! - owes.get(id)!]));
  return { total, paid, owes, bal, cats, shares };
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

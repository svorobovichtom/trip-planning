// Property tests for the money math: thousands of random trips (1–12
// people, all three split modes, discounts, unclaimed lines, deleted people,
// junk values, random transfers) checked against invariants that must hold
// for every trip. Seeded, so a failure is reproducible: the seed is in the
// test name.
import { describe, expect, it, vi } from "vitest";
import { computeLedger, expenseShares, indexClaims, participants, settle, splitModeOf, type Transfer } from "./ledger";
import { grosze, parseAmount, parseG } from "./money";
import { revolutLink } from "./pay";
import { sortPeople } from "./stores";
import type { Claim, Expense, Person, ReceiptLine, Settlement } from "./types";
import { copyDec, fmtDec } from "../features/totals/format";

vi.mock("./pb", () => ({ pb: {} }));
const { buildCsv } = await import("../features/totals/csv");

// ---------- tiny seeded generator ----------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const chance = (p: number) => next() < p;
  const subset = <T,>(xs: readonly T[]) => xs.filter(() => chance(0.5));
  const shuffle = <T,>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { next, int, pick, chance, subset, shuffle };
}
type R = ReturnType<typeof rng>;

/** A PLN amount as the database has it: grosze / 100 (a float). */
const pln = (g: number) => g / 100;
const gAmount = (r: R) => (r.chance(0.1) ? r.int(1, 99) : r.chance(0.1) ? r.int(100_000, 10_000_000) : r.int(100, 50_000));

interface Trip {
  people: Person[];
  expenses: Expense[];
  claims: Claim[];
  settlements: Settlement[];
}

function genTrip(r: R): Trip {
  const n = r.int(1, 12);
  // like the seed: same `created`, distinct `sort`
  const people: Person[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, sort: i + 1, created: "2026-10-01 13:28:27.640Z" }));
  const ids = people.map((p) => p.id);
  const ghost = "deleted0000000"; // a deleted person still referenced by old records
  const someone = () => (r.chance(0.04) ? ghost : r.pick(ids));
  const expenses: Expense[] = [];
  const claims: Claim[] = [];
  const nx = r.int(0, 10);
  for (let k = 0; k < nx; k++) {
    const g = r.chance(0.08) ? 0 : gAmount(r); // 0 = still being scanned
    const x: Expense = {
      id: `x${k}`,
      amount: pln(g),
      paid_by: someone(),
      created: `2026-10-0${1 + (k % 9)} 1${k % 10}:00:00.000Z`,
      split_between: r.chance(0.4) ? [] : [...r.subset(ids), ...(r.chance(0.1) ? [ghost] : [])],
      scan_status: g ? "done" : r.pick(["pending", "running", ""] as const),
    };
    const mode = r.pick(["equal", "amounts", "claims", ""] as const);
    x.split_mode = mode;
    if (mode === "amounts") {
      const who = r.chance(0.1) ? [] : r.subset([...ids, ghost]);
      const sa: Record<string, number | null> = {};
      // fixed parts that may add up to less, exactly, or more than the amount
      let left = Math.round(g * (r.chance(0.2) ? 1.5 : 1));
      for (const id of who) {
        if (r.chance(0.35)) sa[id] = null;
        else {
          const v = r.int(0, Math.max(0, left));
          sa[id] = v;
          left -= v;
        }
      }
      x.split_amounts = sa;
    }
    if (mode === "claims" || r.chance(0.3)) {
      const lines: ReceiptLine[] = [];
      const nl = r.int(0, 8);
      let sum = 0;
      for (let i = 0; i < nl; i++) {
        const disc = i > 0 && r.chance(0.2);
        const lg = disc ? -r.int(1, 500) : r.chance(0.05) ? 0 : r.int(1, 5000);
        const price = r.chance(0.04) ? null : pln(lg);
        if (price !== null) sum += lg;
        lines.push({ text: r.chance(0.05) ? "" : `L${i}`, price, category: r.chance(0.5) ? "Фрукты" : null });
      }
      x.lines = lines;
      // the amount is usually the lines' sum, sometimes not (tip, a discount not on a line, a typo)
      if (g && sum > 0 && r.chance(0.6)) x.amount = pln(r.chance(0.8) ? sum : Math.max(1, sum + r.int(-2000, 2000)));
      if (r.chance(0.1)) x.scan_error = "lines_mismatch";
      lines.forEach((_, i) => {
        if (r.chance(0.3)) return;
        for (const p of r.subset([...ids, ghost])) claims.push({ id: `c${claims.length}`, expense: x.id, line: i, person: p });
        // a duplicate claim (two tabs, an echo) must not count twice
        if (r.chance(0.05) && claims.length) claims.push({ ...claims[claims.length - 1]!, id: `c${claims.length}` });
      });
      if (r.chance(0.05)) claims.push({ id: `c${claims.length}`, expense: x.id, line: 99, person: r.pick(ids) });
    }
    expenses.push(x);
  }
  const settlements: Settlement[] = [];
  const nt = r.int(0, 6);
  for (let k = 0; k < nt; k++) {
    const from = someone();
    const to = r.chance(0.05) ? from : someone();
    const amount = r.chance(0.05) ? r.pick([0, -100, 1.5, Number.NaN]) : r.int(1, 30_000);
    settlements.push({ id: `s${k}`, from, to, amount, created: `2026-10-02 1${k}:00:00.000Z` });
  }
  return { people, expenses, claims, settlements };
}

const ledgerOf = (t: Trip) => computeLedger({ people: t.people, expenses: t.expenses, claims: t.claims, settlements: t.settlements });
const sum = (xs: Iterable<number>) => [...xs].reduce((s, v) => s + v, 0);

const SEEDS = Array.from({ length: 400 }, (_, i) => i * 7919 + 1);

describe("random trips: invariants", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const r = rng(seed);
    const t = genTrip(r);
    const order = t.people.map((p) => p.id);
    const L = ledgerOf(t);
    const idx = indexClaims(t.claims, order);

    // 1. balances add up to exactly 0 gr
    expect(sum(L.bal.values())).toBe(0);
    // paid − owes adds up to 0 too (trip spending alone), and sent = received
    expect(sum(L.paid.values())).toBe(sum(L.owes.values()));
    expect(sum(L.sent.values())).toBe(sum(L.received.values()));

    for (const x of t.expenses) {
      const g = grosze(x.amount);
      const s = L.shares.get(x.id)!;
      const counts = g > 0 && order.includes(x.paid_by);
      // 2. each counted expense's shares add up to its amount exactly; others count for nobody
      expect(sum(s.values())).toBe(counts ? g : 0);
      for (const [id, v] of s) {
        // 3. nobody's share is negative, only known people, integer grosze
        expect(v).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(v)).toBe(true);
        expect(order).toContain(id);
      }
      if (!counts) continue;
      // same as expenseShares on its own (the UI's per-expense view)
      expect(s).toEqual(expenseShares(x, order, idx.get(x.id)));
      // 4. equal: exactly the participants, at most 1 gr apart, extra grosze to the first in list order
      if (splitModeOf(x, order) === "equal") {
        const pool = participants(x, order);
        for (const id of s.keys()) expect(pool).toContain(id);
        const vs = pool.map((id) => s.get(id) ?? 0);
        expect(Math.max(...vs) - Math.min(...vs)).toBeLessThanOrEqual(1);
        expect(vs).toEqual([...vs].sort((a, b) => b - a));
      }
    }

    // 5. suggested transfers
    const tx = settle(L.bal);
    const after = new Map(L.bal);
    for (const x of tx) {
      expect(x.from).not.toBe(x.to);
      expect(Number.isInteger(x.g)).toBe(true);
      expect(x.g).toBeGreaterThan(0);
      // only from debtors to creditors, never more than they owe / are owed
      expect(L.bal.get(x.from)!).toBeLessThan(0);
      expect(L.bal.get(x.to)!).toBeGreaterThan(0);
      after.set(x.from, after.get(x.from)! + x.g);
      after.set(x.to, after.get(x.to)! - x.g);
    }
    // applying them makes every balance exactly 0
    for (const v of after.values()) expect(v).toBe(0);
    const nonzero = [...L.bal.values()].filter((v) => v !== 0).length;
    expect(tx.length).toBeLessThanOrEqual(Math.max(0, nonzero - 1));
    expect(tx.length).toBeLessThanOrEqual(Math.max(0, order.length - 1));
    // at most one transfer per pair
    expect(new Set(tx.map((x) => `${x.from}>${x.to}`)).size).toBe(tx.length);

    // 6. the same on every phone: record order from the server doesn't matter
    for (let k = 0; k < 3; k++) {
      const t2: Trip = {
        people: sortPeople(r.shuffle(t.people)),
        expenses: r.shuffle(t.expenses),
        claims: r.shuffle(t.claims),
        settlements: r.shuffle(t.settlements),
      };
      const L2 = ledgerOf(t2);
      expect([...L2.bal]).toEqual([...L.bal]);
      expect(settle(L2.bal)).toEqual(tx);
      for (const x of t.expenses) expect([...L2.shares.get(x.id)!].sort()).toEqual([...L.shares.get(x.id)!].sort());
    }

    // 7. what a person sends is exactly the transfer: Revolut link, copied amount, typed back in «Перевёл»
    for (const x of tx) {
      const link = revolutLink("yulia", x.g)!;
      expect(new URL(link).searchParams.get("amount")).toBe(String(x.g));
      expect(new URL(link).searchParams.get("currency")).toBe("PLN");
      expect(parseG(copyDec(x.g))).toBe(x.g);
      expect(Math.round(parseAmount(copyDec(x.g)) * 100)).toBe(x.g);
      expect(parseG(fmtDec(x.g))).toBe(x.g);
    }

    // 8. CSV totals match the ledger
    checkCsv(t, L, tx);
  });
});

function checkCsv(t: Trip, L: ReturnType<typeof ledgerOf>, tx: Transfer[]) {
  const csv = buildCsv(t);
  const rows = csv.replace(/^﻿/, "").split("\r\n").map((l) => (l ? l.split(";").map((c) => c.slice(1, -1).replace(/""/g, '"')) : []));
  const g = (s: string) => (s === "" ? 0 : Math.round(Number(s.replace(",", ".")) * 100));
  const n = t.people.length;
  const blank = rows.findIndex((r) => !r.length);
  const xs = rows.slice(1, blank);
  expect(xs.length).toBe(t.expenses.length);
  for (const r of xs) {
    const shares = r.slice(8, 8 + n).map(g);
    const amount = g(r[3]!);
    const x = t.expenses.find((e) => grosze(e.amount) === amount && r[5] === (t.people.find((p) => p.id === e.paid_by)?.name ?? ""));
    expect(x).toBeDefined();
    // a counted expense's columns add up to its amount; uncounted ones are empty
    expect(sum(shares)).toBe(sum(L.shares.get(x!.id)!.values()));
  }
  const balHead = rows.findIndex((r) => r[0] === "Кто" && r[5] === "Баланс");
  t.people.forEach((p, i) => {
    const r = rows[balHead + 1 + i]!;
    expect(r[0]).toBe(p.name);
    expect([g(r[1]!), g(r[2]!), g(r[3]!), g(r[4]!), g(r[5]!)]).toEqual([
      L.paid.get(p.id), L.owes.get(p.id), L.sent.get(p.id), L.received.get(p.id), L.bal.get(p.id),
    ]);
  });
  const left = rows.slice(rows.findIndex((r) => r[0] === "Осталось перевести") + 2).filter((r) => r.length);
  const name = (id: string) => t.people.find((p) => p.id === id)!.name;
  expect(left).toEqual(tx.map((x) => [name(x.from), name(x.to), (x.g / 100).toFixed(2).replace(".", ",")]));
}

describe("parseG: exact for every amount", () => {
  it("round-trips every grosz value through the input formats", () => {
    const r = rng(42);
    for (let k = 0; k < 20000; k++) {
      const g = k < 2000 ? k : r.int(0, 100_000_000);
      const zl = Math.floor(g / 100);
      const gr = String(g % 100).padStart(2, "0");
      expect(parseG(`${zl},${gr}`)).toBe(g);
      expect(parseG(`${zl}.${gr}`)).toBe(g);
      expect(parseG(copyDec(g))).toBe(g);
      expect(parseG(fmtDec(g))).toBe(g);
      expect(grosze(parseAmount(`${zl},${gr}`))).toBe(g);
    }
  });
});

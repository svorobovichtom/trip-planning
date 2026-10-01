import { describe, expect, it } from "vitest";
import { byOrder, computeLedger, expenseShares, indexClaims, linesOk, settle, splitEven } from "./ledger";
import type { Expense } from "./types";

const order = ["a", "b", "c"];
const people = order.map((id) => ({ id }));
const X = (p: Partial<Expense>): Expense => ({ id: "x", amount: 0, paid_by: "a", ...p });
const obj = (m: Map<string, number>) => Object.fromEntries(m);
const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

describe("splitEven", () => {
  it("gives leftover grosze to the first people", () => {
    const m = new Map<string, number>();
    splitEven(100, order, m);
    expect(obj(m)).toEqual({ a: 34, b: 33, c: 33 });
  });
  it("adds into existing values and ignores zero / nobody", () => {
    const m = new Map([["a", 5]]);
    splitEven(0, order, m);
    splitEven(10, [], m);
    splitEven(2, ["a", "b"], m);
    expect(obj(m)).toEqual({ a: 6, b: 1 });
  });
  it("handles a negative remainder exactly", () => {
    const m = new Map<string, number>();
    splitEven(-5, ["a", "b"], m);
    expect(sum(m)).toBe(-5);
  });
});

describe("byOrder", () => {
  it("dedupes, drops unknown ids, sorts by list order", () => {
    expect(byOrder(["c", "zz", "a", "c"], order)).toEqual(["a", "c"]);
  });
});

describe("expenseShares: equal", () => {
  it("splits between everyone when split_between is empty", () => {
    expect(obj(expenseShares(X({ amount: 10 }), order))).toEqual({ a: 334, b: 333, c: 333 });
  });
  it("splits between split_between in list order (remainder to the first in list order)", () => {
    expect(obj(expenseShares(X({ amount: 0.03, split_between: ["c", "b"] }), order))).toEqual({ b: 2, c: 1 });
  });
  it("falls back to everyone when split_between has only unknown ids", () => {
    expect(sum(expenseShares(X({ amount: 1, split_between: ["zz"] }), order))).toBe(100);
  });
  it("ignores amount 0 (still being scanned)", () => {
    expect(expenseShares(X({ amount: 0 }), order).size).toBe(0);
  });
  it("8 people, 352,35: the first three get the extra grosz", () => {
    const eight = ["t", "b", "c", "d", "e", "f", "g", "h"];
    const s = expenseShares(X({ amount: 352.35, paid_by: "t" }), eight);
    expect([...s.values()]).toEqual([4405, 4405, 4405, 4404, 4404, 4404, 4404, 4404]);
    expect(35235 - s.get("t")!).toBe(30830);
  });
  it("rounds float amounts to grosze", () => {
    expect(sum(expenseShares(X({ amount: 123.45 }), order))).toBe(12345);
  });
});

describe("expenseShares: amounts", () => {
  it("fixed shares plus auto (null) get the rest equally", () => {
    const x = X({ amount: 100, split_mode: "amounts", split_amounts: { a: 4000, b: null, c: null } });
    expect(obj(expenseShares(x, order))).toEqual({ a: 4000, b: 3000, c: 3000 });
  });
  it("remainder grosze go to the first auto person in list order", () => {
    const x = X({ amount: 1.01, split_mode: "amounts", split_amounts: { c: null, b: null, a: 0 } });
    expect(obj(expenseShares(x, order))).toEqual({ a: 0, b: 51, c: 50 });
  });
  it("without autos the rest goes to the participants", () => {
    const x = X({ amount: 10, split_mode: "amounts", split_amounts: { a: 400 }, split_between: ["b", "c"] });
    expect(obj(expenseShares(x, order))).toEqual({ a: 400, b: 300, c: 300 });
  });
  it("treats an empty string as «авто»", () => {
    const x = X({ amount: 3, split_mode: "amounts", split_amounts: { a: "" as unknown as null, b: 100 } });
    expect(obj(expenseShares(x, order))).toEqual({ a: 200, b: 100 });
  });
  it("falls back to equal when split_amounts is empty or unknown ids", () => {
    const x = X({ amount: 3, split_mode: "amounts", split_amounts: { zz: 100 } });
    expect(obj(expenseShares(x, order))).toEqual({ a: 100, b: 100, c: 100 });
  });
  it("always adds up to the amount", () => {
    const x = X({ amount: 99.99, split_mode: "amounts", split_amounts: { a: 1234, b: null, c: null } });
    expect(sum(expenseShares(x, order))).toBe(9999);
  });
});

describe("expenseShares: claims", () => {
  const lines = [
    { text: "Пиво", price: 30 },
    { text: "Сыр", price: 20 },
    { text: "Хлеб", price: 10 },
  ];
  it("splits claimed lines among claimers, the rest (unclaimed + total − lines) among participants", () => {
    const x = X({ id: "e1", amount: 63, split_mode: "claims", lines });
    const idx = indexClaims(
      [
        { expense: "e1", line: 0, person: "b" },
        { expense: "e1", line: 0, person: "a" },
        { expense: "e1", line: 1, person: "c" },
      ],
      order,
    );
    // line 0: 3000 -> a 1500, b 1500; line 1: 2000 -> c; rest: 1000 + 300 = 1300 -> 434/433/433
    expect(obj(expenseShares(x, order, idx.get("e1")))).toEqual({ a: 1934, b: 1933, c: 2433 });
  });
  it("falls back to equal when lines don't add up", () => {
    const x = X({ id: "e1", amount: 3, split_mode: "claims", lines, scan_error: "lines_mismatch" });
    const idx = indexClaims([{ expense: "e1", line: 0, person: "a" }], order);
    expect(obj(expenseShares(x, order, idx.get("e1")))).toEqual({ a: 100, b: 100, c: 100 });
  });
  it("ignores claims by unknown people (line goes to the rest)", () => {
    const x = X({ id: "e1", amount: 60, split_mode: "claims", lines, split_between: ["a"] });
    const idx = indexClaims([{ expense: "e1", line: 0, person: "zz" }], order);
    expect(obj(expenseShares(x, order, idx.get("e1")))).toEqual({ a: 6000 });
  });
  it("handles discounts (negative lines) and adds up", () => {
    const x = X({ id: "e1", amount: 25, split_mode: "claims", lines: [{ text: "A", price: 30 }, { text: "Rabat", price: -5 }] });
    const idx = indexClaims([{ expense: "e1", line: 0, person: "a" }], order);
    const s = expenseShares(x, order, idx.get("e1"));
    expect(sum(s)).toBe(2500);
    expect(s.get("a")).toBe(3000 - 166);
  });
  it("linesOk needs at least one line with text and no mismatch", () => {
    expect(linesOk(X({ lines: [] }))).toBe(false);
    expect(linesOk(X({ lines: [{ text: "" }] }))).toBe(false);
    expect(linesOk(X({ lines: [{ text: "A" }] }))).toBe(true);
    expect(linesOk(X({ lines: [{ text: "A" }], scan_error: "lines_mismatch" }))).toBe(false);
  });
});

describe("computeLedger + settle", () => {
  it("balances paid against shares and settles greedily", () => {
    const L = computeLedger({
      people,
      expenses: [
        X({ id: "1", amount: 90, paid_by: "a", category: "Бакалея" }),
        X({ id: "2", amount: 30, paid_by: "b", split_between: ["b", "c"] }),
        X({ id: "3", amount: 0, paid_by: "c" }),
      ],
      claims: [],
    });
    expect(L.total).toBe(12000);
    expect(obj(L.paid)).toEqual({ a: 9000, b: 3000, c: 0 });
    expect(obj(L.owes)).toEqual({ a: 3000, b: 4500, c: 4500 });
    expect(obj(L.bal)).toEqual({ a: 6000, b: -1500, c: -4500 });
    expect(obj(L.cats)).toEqual({ Бакалея: 9000, Другое: 3000 });
    expect(settle(L.bal)).toEqual([
      { from: "c", to: "a", g: 4500 },
      { from: "b", to: "a", g: 1500 },
    ]);
  });
  it("ignores a payer who is not in the list", () => {
    const L = computeLedger({ people, expenses: [X({ amount: 3, paid_by: "zz" })], claims: [] });
    expect(sum(L.bal)).toBe(-300);
  });
  it("settle: nothing to do when square; several creditors", () => {
    expect(settle(new Map([["a", 0], ["b", 0]]))).toEqual([]);
    const t = settle(new Map([["a", 500], ["b", 300], ["c", -800]]));
    expect(t).toEqual([
      { from: "c", to: "a", g: 500 },
      { from: "c", to: "b", g: 300 },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { byOrder, computeLedger, expenseCats, expenseShares, indexClaims, linesOk, settle, sortedCats, splitEven, splitModeOf } from "./ledger";
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
  it("a discount folds into the claimed line above it (as the claims list shows it)", () => {
    // before: a paid 30,00 − 1,66 and b, c got −1,67 each for a discount on a line only a took
    const x = X({ id: "e1", amount: 25, split_mode: "claims", lines: [{ text: "A", price: 30 }, { text: "Rabat", price: -5 }] });
    const idx = indexClaims([{ expense: "e1", line: 0, person: "a" }], order);
    expect(obj(expenseShares(x, order, idx.get("e1")))).toEqual({ a: 2500 });
    // also when the discount line was claimed too (what toggleClaim does) — same result
    const idx2 = indexClaims([{ expense: "e1", line: 0, person: "a" }, { expense: "e1", line: 1, person: "a" }], order);
    expect(obj(expenseShares(x, order, idx2.get("e1")))).toEqual({ a: 2500 });
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
  it("an expense whose payer is not in the list (deleted) counts for nobody's balance", () => {
    // before: a, b, c each owed 1 zł to nobody (balances summed to −3 zł, settle() left it unpaid)
    const L = computeLedger({ people, expenses: [X({ id: "e", amount: 3, paid_by: "zz" })], claims: [] });
    expect(sum(L.bal)).toBe(0);
    expect(obj(L.bal)).toEqual({ a: 0, b: 0, c: 0 });
    expect(L.shares.get("e")!.size).toBe(0);
    expect(L.total).toBe(300);
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

describe("expenseCats", () => {
  it("no lines: the expense's category, or «Другое»", () => {
    expect(obj(expenseCats(X({ amount: 12.5, category: "Жильё" })))).toEqual({ Жильё: 1250 });
    expect(obj(expenseCats(X({ amount: 12.5 })))).toEqual({ Другое: 1250 });
    expect(obj(expenseCats(X({ amount: 3, lines: [] })))).toEqual({ Другое: 300 });
  });
  it("amount 0 counts for nothing", () => {
    expect(expenseCats(X({ amount: 0, lines: [{ text: "A", price: 5, category: "Фрукты" }] })).size).toBe(0);
  });
  it("lines by their category; a line without one and the remainder go to the expense's category", () => {
    const x = X({
      amount: 100,
      category: "Бакалея",
      lines: [
        { text: "Шея", price: 40, category: "Мясо и рыба" },
        { text: "Пиво", price: 30.5, category: "Напитки и алкоголь" },
        { text: "Пакет", price: 0.5 },
        { text: "?", price: null, category: "Снеки" },
        { text: "", price: 9, category: "Снеки" },
      ],
    });
    expect(obj(expenseCats(x))).toEqual({ "Мясо и рыба": 4000, "Напитки и алкоголь": 3050, Бакалея: 2950 });
  });
  it("remainder goes to «Другое» when the expense has no category", () => {
    const x = X({ amount: 10, lines: [{ text: "Сыр", price: 7, category: "Молочка и яйца" }] });
    expect(obj(expenseCats(x))).toEqual({ "Молочка и яйца": 700, Другое: 300 });
  });
  it("a discount folds into the line above it", () => {
    const x = X({
      amount: 25,
      lines: [
        { text: "Шея", price: 20, category: "Мясо и рыба" },
        { text: "Rabat", price: -5, category: "Другое" },
        { text: "Сок", price: 10, category: "Напитки и алкоголь" },
      ],
    });
    expect(obj(expenseCats(x))).toEqual({ "Мясо и рыба": 1500, "Напитки и алкоголь": 1000 });
  });
  it("lines above the amount: spread in proportion, adds up exactly", () => {
    const x = X({
      amount: 10,
      lines: [
        { text: "A", price: 10, category: "Фрукты" },
        { text: "B", price: 10, category: "Снеки" },
        { text: "C", price: 10, category: "Бакалея" },
      ],
    });
    const c = expenseCats(x);
    expect(sum(c)).toBe(1000);
    expect([...c.values()].sort()).toEqual([333, 333, 334]);
  });
  it("only discounts: all to the expense's category", () => {
    expect(obj(expenseCats(X({ amount: 5, category: "Снеки", lines: [{ text: "Rabat", price: -1 }] })))).toEqual({ Снеки: 500 });
  });
  it("sortedCats: biggest first, zeros dropped", () => {
    expect(sortedCats(new Map([["Б", 5], ["А", 5], ["В", 9], ["Г", 0]]))).toEqual([["В", 9], ["А", 5], ["Б", 5]]);
  });
});

describe("computeLedger: categories and the 8-person trip", () => {
  const eight = ["t", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ id }));
  it("categories come from lines and add up to the total", () => {
    const L = computeLedger({
      people: eight,
      expenses: [
        X({
          id: "lidl",
          amount: 352.35,
          paid_by: "t",
          lines: [
            { text: "Шея", price: 150.2, category: "Мясо и рыба" },
            { text: "Rabat", price: -10.2, category: "Мясо и рыба" },
            { text: "Пиво", price: 120, category: "Напитки и алкоголь" },
            { text: "Хлеб", price: 50, category: "Бакалея" },
          ],
        }),
      ],
      claims: [],
    });
    expect(L.total).toBe(35235);
    expect(sum(L.cats)).toBe(L.total);
    expect(obj(L.cats)).toEqual({ "Мясо и рыба": 14000, "Напитки и алкоголь": 12000, Бакалея: 5000, Другое: 4235 });
    expect(L.bal.get("t")).toBe(30830);
    const tx = settle(L.bal);
    expect(tx.every((t) => t.to === "t")).toBe(true);
    expect(tx.reduce((s, t) => s + t.g, 0)).toBe(30830);
  });
  it("no expenses: zeros everywhere, nothing to settle", () => {
    const L = computeLedger({ people: eight, expenses: [], claims: [] });
    expect(L.total).toBe(0);
    expect(L.cats.size).toBe(0);
    expect([...L.bal.values()].every((v) => v === 0)).toBe(true);
    expect(settle(L.bal)).toEqual([]);
  });
});

describe("computeLedger: settlements («переведено»)", () => {
  // a paid 90 for everyone: b and c owe a 30,00 each
  const expenses = [X({ id: "1", amount: 90, paid_by: "a" })];
  const L = (settlements: { from: string; to: string; amount: number }[]) => computeLedger({ people, expenses, claims: [], settlements });

  it("without transfers nothing changes", () => {
    const l = L([]);
    expect(obj(l.bal)).toEqual({ a: 6000, b: -3000, c: -3000 });
    expect(obj(l.settled)).toEqual({ a: 0, b: 0, c: 0 });
  });
  it("partial transfer: only the rest is left to settle", () => {
    const l = L([{ from: "b", to: "a", amount: 1000 }]);
    expect(obj(l.bal)).toEqual({ a: 5000, b: -2000, c: -3000 });
    expect(obj(l.paid)).toEqual({ a: 9000, b: 0, c: 0 });
    expect(obj(l.owes)).toEqual({ a: 3000, b: 3000, c: 3000 });
    expect(obj(l.sent)).toEqual({ a: 0, b: 1000, c: 0 });
    expect(obj(l.received)).toEqual({ a: 1000, b: 0, c: 0 });
    expect(obj(l.settled)).toEqual({ a: -1000, b: 1000, c: 0 });
    expect(settle(l.bal)).toEqual([
      { from: "c", to: "a", g: 3000 },
      { from: "b", to: "a", g: 2000 },
    ]);
  });
  it("full transfers: everyone «в расчёте», nothing to settle", () => {
    const l = L([
      { from: "b", to: "a", amount: 3000 },
      { from: "c", to: "a", amount: 1000 },
      { from: "c", to: "a", amount: 2000 },
    ]);
    expect(obj(l.bal)).toEqual({ a: 0, b: 0, c: 0 });
    expect(settle(l.bal)).toEqual([]);
  });
  it("over-transfer reverses the debt", () => {
    const l = L([
      { from: "b", to: "a", amount: 5000 },
      { from: "c", to: "a", amount: 3000 },
    ]);
    expect(obj(l.bal)).toEqual({ a: -2000, b: 2000, c: 0 });
    expect(settle(l.bal)).toEqual([{ from: "a", to: "b", g: 2000 }]);
  });
  it("ignores unknown people, self-transfers and bad amounts; balances still add up to 0", () => {
    const l = L([
      { from: "zz", to: "a", amount: 500 },
      { from: "b", to: "b", amount: 500 },
      { from: "b", to: "a", amount: 0 },
      { from: "b", to: "a", amount: -100 },
      { from: "b", to: "a", amount: Number.NaN },
    ]);
    expect(obj(l.bal)).toEqual({ a: 6000, b: -3000, c: -3000 });
    expect(sum(L([{ from: "c", to: "b", amount: 777 }]).bal)).toBe(0);
  });
});

describe("splitModeOf", () => {
  it("reports the mode expenseShares really used", () => {
    expect(splitModeOf(X({ amount: 1 }), order)).toBe("equal");
    expect(splitModeOf(X({ amount: 1, split_mode: "amounts", split_amounts: { b: 50 } }), order)).toBe("amounts");
    expect(splitModeOf(X({ amount: 1, split_mode: "amounts", split_amounts: { zz: 50 } }), order)).toBe("equal");
    expect(splitModeOf(X({ amount: 1, split_mode: "claims", lines: [{ text: "x", price: 1 }] }), order)).toBe("claims");
    expect(splitModeOf(X({ amount: 1, split_mode: "claims", lines: [{ text: "x", price: 1 }], scan_error: "lines_mismatch" }), order)).toBe("equal");
  });
});

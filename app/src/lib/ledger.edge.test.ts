// Edge cases of the money math with hand-computed expectations (grosze).
// People a, b, c in list order unless said otherwise.
import { describe, expect, it } from "vitest";
import { computeLedger, expenseShares, groupHeads, indexClaims, receiptRows, settle, splitProp } from "./ledger";
import { sortPeople } from "./stores";
import type { Claim, Expense, Person, Settlement } from "./types";

const order = ["a", "b", "c"];
const people = order.map((id) => ({ id }));
const X = (p: Partial<Expense>): Expense => ({ id: "x", amount: 0, paid_by: "a", ...p });
const obj = <V>(m: Map<string, V>) => Object.fromEntries(m);
const C = (line: number, person: string, expense = "x"): Pick<Claim, "expense" | "line" | "person"> => ({ expense, line, person });
const shares = (x: Expense, claims: Pick<Claim, "expense" | "line" | "person">[] = [], o = order) =>
  obj(expenseShares(x, o, indexClaims(claims, o).get(x.id)));
const bal = (expenses: Expense[], claims: Pick<Claim, "expense" | "line" | "person">[] = [], settlements: Pick<Settlement, "from" | "to" | "amount">[] = []) =>
  obj(computeLedger({ people, expenses, claims, settlements }).bal);

describe("amount 0 / still scanning", () => {
  it("counts for nobody, even with a split and claims", () => {
    const x = X({ amount: 0, scan_status: "pending", split_mode: "claims", lines: [{ text: "A", price: 10 }] });
    expect(bal([x], [C(0, "b")])).toEqual({ a: 0, b: 0, c: 0 });
    expect(computeLedger({ people, expenses: [x], claims: [] }).total).toBe(0);
  });
  it("a typed amount counts while the receipt is still being read", () => {
    expect(bal([X({ amount: 30, scan_status: "running" })])).toEqual({ a: 2000, b: -1000, c: -1000 });
  });
  it("a negative amount (impossible in the schema) counts for nobody", () => {
    expect(bal([X({ amount: -30 })])).toEqual({ a: 0, b: 0, c: 0 });
  });
});

describe("equal", () => {
  it("payer not in the split: gets it all back", () => {
    expect(bal([X({ amount: 10, split_between: ["b", "c"] })])).toEqual({ a: 1000, b: -500, c: -500 });
  });
  it("0,10 between 3: 4 / 3 / 3, the extra grosz to the first in list order", () => {
    expect(shares(X({ amount: 0.1 }))).toEqual({ a: 4, b: 3, c: 3 });
  });
  it("0,01 between 3: only the first pays (nobody pays a negative or a fraction)", () => {
    expect(shares(X({ amount: 0.01 }))).toEqual({ a: 1, b: 0, c: 0 });
  });
  it("prod: 128,06 between 9 -> eight pay 14,23, the last 14,22", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `p${i}`);
    const s = expenseShares(X({ amount: 128.06, paid_by: "p6" }), nine);
    expect([...s.values()]).toEqual([1423, 1423, 1423, 1423, 1423, 1423, 1423, 1423, 1422]);
  });
});

describe("amounts («Суммами»)", () => {
  it("written down more than the amount (scan filled a smaller total): parts shrink in proportion, «авто» 0", () => {
    // before: c («авто») got −10,00
    const x = X({ amount: 90, split_mode: "amounts", split_amounts: { a: 6000, b: 4000, c: null } });
    expect(shares(x)).toEqual({ a: 5400, b: 3600 });
  });
  it("proportional leftovers: largest remainder, ties in list order", () => {
    const x = X({ amount: 1, split_mode: "amounts", split_amounts: { c: 100, b: 100, a: 100 } });
    expect(shares(x)).toEqual({ a: 34, b: 33, c: 33 });
  });
  it("not reaching the amount and nobody «авто»: the rest evenly between the participants (the form blocks this for a typed total)", () => {
    const x = X({ amount: 10, split_mode: "amounts", split_amounts: { a: 400, b: 300 } });
    expect(shares(x)).toEqual({ a: 500, b: 400, c: 100 });
  });
  it("several «авто»: the rest evenly, extra grosz to the first «авто»", () => {
    const x = X({ amount: 10.01, split_mode: "amounts", split_amounts: { a: 1, b: null, c: null } });
    expect(shares(x)).toEqual({ a: 1, b: 500, c: 500 });
  });
  it("a deleted person's fixed part goes to the «авто» people", () => {
    const x = X({ amount: 30, split_mode: "amounts", split_amounts: { a: 1000, zz: 1000, b: null } });
    expect(shares(x)).toEqual({ a: 1000, b: 2000 });
  });
  it("exactly the amount, nobody «авто»", () => {
    const x = X({ amount: 15.5, split_mode: "amounts", split_amounts: { a: 1000, b: 550 } });
    expect(shares(x)).toEqual({ a: 1000, b: 550 });
  });
});

describe("claims («По чеку»)", () => {
  const lines = [
    { text: "Пиво", price: 30 },
    { text: "Сыр", price: 20 },
    { text: "Хлеб", price: 10 },
  ];
  const cl = (p: Partial<Expense>) => X({ split_mode: "claims", lines, amount: 60, ...p });
  it("unclaimed lines are shared evenly by all participants (claimers included)", () => {
    // Пиво -> a; Сыр + Хлеб (30,00) unclaimed -> 10,00 each
    expect(shares(cl({}), [C(0, "a")])).toEqual({ a: 4000, b: 1000, c: 1000 });
  });
  it("unclaimed lines only between split_between", () => {
    expect(shares(cl({ split_between: ["b", "c"] }), [C(0, "a")])).toEqual({ a: 3000, b: 1500, c: 1500 });
  });
  it("several people on one line split it, extra grosz to the first in list order", () => {
    const x = cl({ amount: 10, lines: [{ text: "Пицца", price: 10 }] });
    expect(shares(x, [C(0, "c"), C(0, "a"), C(0, "b")])).toEqual({ a: 334, b: 333, c: 333 });
  });
  it("nobody claimed anything yet: plain equal", () => {
    expect(shares(cl({}))).toEqual({ a: 2000, b: 2000, c: 2000 });
  });
  it("amount above the lines (tip, bag): the difference evenly between the participants", () => {
    // a 30 + 1,67, b 20 + 1,67, c 1,66
    expect(shares(cl({ amount: 55, lines: lines.slice(0, 2) }), [C(0, "a"), C(1, "b")])).toEqual({ a: 3167, b: 2167, c: 166 });
  });
  it("claimed lines above the amount (a discount not on any line): split in proportion to what each claimed", () => {
    // before: c got −10,00 for nothing
    const x = cl({ amount: 120, lines: [{ text: "A", price: 100 }, { text: "B", price: 50 }] });
    expect(shares(x, [C(0, "a"), C(1, "b")])).toEqual({ a: 8000, b: 4000 });
  });
  it("a discount line is part of the product above it, also when only the product line is claimed", () => {
    // Помидоры 28,00 − 14,00 = 14,00 -> b; Хлеб 6,00 -> c. Before: b paid 28,00 − 4,67, a and c got −4,67 + …
    const x = X({ split_mode: "claims", amount: 20, lines: [{ text: "Помидоры", price: 28 }, { text: "Rabat", price: -14 }, { text: "Хлеб", price: 6 }] });
    expect(shares(x, [C(0, "b"), C(2, "c")])).toEqual({ b: 1400, c: 600 });
    // the folded discount's own claims follow the product line's
    expect(shares(x, [C(0, "b"), C(1, "b"), C(1, "a"), C(2, "c")])).toEqual({ b: 1400, c: 600 });
  });
  it("someone claiming only a stray discount row never gets a negative share", () => {
    // rows: A 30 − 5 (a), Rabat2 −5 (b only). Raw: a 25, b −5 -> in proportion to the positive part: a 20
    const x = X({ split_mode: "claims", amount: 20, lines: [{ text: "A", price: 30 }, { text: "R1", price: -5 }, { text: "R2", price: -5 }] });
    expect(shares(x, [C(0, "a"), C(2, "b")])).toEqual({ a: 2000 });
  });
  it("claims on a missing line, by deleted people, and duplicates don't count", () => {
    const x = cl({});
    expect(shares(x, [C(9, "a"), C(0, "zz"), C(1, "b"), C(1, "b")])).toEqual({ a: 1334, b: 3333, c: 1333 });
  });
  it("lines that don't add up (lines_mismatch): equal", () => {
    expect(shares(cl({ scan_error: "lines_mismatch" }), [C(0, "a")])).toEqual({ a: 2000, b: 2000, c: 2000 });
  });
  it("receiptRows folds one discount into a positive line with a known price", () => {
    const rows = receiptRows([
      { text: "A", price: 10 }, { text: "R", price: -2 }, { text: "R", price: -1 },
      { text: "B", price: null }, { text: "R", price: -1 }, { text: "", price: 5 }, null,
    ]);
    expect(rows).toEqual([
      { idx: 0, extra: [1], g: 800, discount: -200 },
      { idx: 2, extra: [], g: -100, discount: 0 },
      { idx: 3, extra: [], g: null, discount: 0 },
      { idx: 4, extra: [], g: -100, discount: 0 },
    ]);
  });
});

describe("people deleted or renamed", () => {
  it("a deleted payer's expense counts for nobody (balances still add up to 0)", () => {
    expect(bal([X({ amount: 30, paid_by: "zz" }), X({ id: "y", amount: 30, paid_by: "b" })])).toEqual({ a: -1000, b: 2000, c: -1000 });
  });
  it("split_between with only deleted people means everyone", () => {
    expect(shares(X({ amount: 3, split_between: ["zz"] }))).toEqual({ a: 100, b: 100, c: 100 });
  });
  it("renaming changes nothing (everything is by id)", () => {
    const ps: Person[] = [{ id: "a", name: "Аня" }, { id: "b", name: "Боря" }];
    const xs = [X({ amount: 10 })];
    const before = computeLedger({ people: ps, expenses: xs, claims: [] }).bal;
    const after = computeLedger({ people: [{ ...ps[0]!, name: "Анна" }, ps[1]!], expenses: xs, claims: [] }).bal;
    expect(after).toEqual(before);
  });
});

describe("settlements", () => {
  const x = X({ amount: 30 }); // a +20, b −10, c −10
  it("partial, exact and larger than the debt", () => {
    expect(bal([x], [], [{ from: "b", to: "a", amount: 400 }])).toEqual({ a: 1600, b: -600, c: -1000 });
    expect(bal([x], [], [{ from: "b", to: "a", amount: 1000 }])).toEqual({ a: 1000, b: 0, c: -1000 });
    // over-paid: a now owes b 5,00
    expect(bal([x], [], [{ from: "b", to: "a", amount: 1500 }])).toEqual({ a: 500, b: 500, c: -1000 });
  });
  it("the wrong direction (creditor -> debtor) adds to the debt, still adds up to 0", () => {
    expect(bal([x], [], [{ from: "a", to: "b", amount: 500 }])).toEqual({ a: 2500, b: -1500, c: -1000 });
  });
  it("two identical records are two transfers (each can be undone on its own)", () => {
    const t = { from: "b", to: "a", amount: 500 };
    expect(bal([x], [], [t, t])).toEqual({ a: 1000, b: 0, c: -1000 });
  });
  it("junk is ignored: self, unknown people, 0, negative, NaN", () => {
    const junk = [
      { from: "a", to: "a", amount: 500 }, { from: "zz", to: "a", amount: 500 }, { from: "b", to: "zz", amount: 500 },
      { from: "b", to: "a", amount: 0 }, { from: "b", to: "a", amount: -5 }, { from: "b", to: "a", amount: Number.NaN },
    ];
    expect(bal([x], [], junk)).toEqual({ a: 2000, b: -1000, c: -1000 });
  });
});

describe("settle", () => {
  it("prod (1 Oct): 7 transfers for 8 people with a balance", () => {
    const b = new Map([
      ["yu", 0], ["tom", 24559], ["f1", -5338], ["f2", -5338], ["li", -5338], ["al", -5338], ["se", 7468], ["au", -5338], ["ok", -5337],
    ]);
    expect(settle(b)).toEqual([
      { from: "f1", to: "tom", g: 5338 },
      { from: "f2", to: "tom", g: 5338 },
      { from: "li", to: "tom", g: 5338 },
      { from: "al", to: "tom", g: 5338 },
      { from: "au", to: "tom", g: 3207 },
      { from: "au", to: "se", g: 2131 },
      { from: "ok", to: "se", g: 5337 },
    ]);
  });
  it("ties go in list order, so every phone with the same list shows the same transfers", () => {
    expect(settle(new Map([["a", -100], ["b", -100], ["c", 200]]))).toEqual([
      { from: "a", to: "c", g: 100 },
      { from: "b", to: "c", g: 100 },
    ]);
  });
  it("the list order itself is the same on every phone: sort, then created", () => {
    const ps: Person[] = [
      { id: "z", name: "Z", sort: 2, created: "2026-10-01 13:28:27.640Z" },
      { id: "y", name: "Y", sort: 1, created: "2026-10-01 13:28:27.640Z" },
      { id: "x", name: "X", sort: 3, created: "2026-10-01 13:00:00.000Z" },
    ];
    expect(sortPeople(ps).map((p) => p.id)).toEqual(["y", "z", "x"]);
    expect(sortPeople([...ps].reverse()).map((p) => p.id)).toEqual(["y", "z", "x"]);
  });
});

describe("splitProp", () => {
  it("is exact for huge amounts (no float overflow)", () => {
    const into = new Map<string, number>();
    splitProp(100_000_000, new Map([["a", 99_999_999], ["b", 1], ["c", 1]]), order, into);
    expect([...into.values()].reduce((s, v) => s + v, 0)).toBe(100_000_000);
    expect(obj(into)).toEqual({ a: 99_999_998, b: 1, c: 1 });
  });
  it("nothing positive to weigh by: false, nothing added", () => {
    const into = new Map<string, number>();
    expect(splitProp(100, new Map([["a", 0], ["b", -5]]), order, into)).toBe(false);
    expect(into.size).toBe(0);
  });
});

describe("leftover grosze: fair across the trip", () => {
  it("rotate to whoever got the fewest so far, in created order", () => {
    const xs = [1, 2, 3].map((k) => X({ id: `x${k}`, amount: 0.01, created: `2026-10-01 1${k}:00:00.000Z` }));
    const L = computeLedger({ people, expenses: [...xs].reverse(), claims: [] });
    expect(xs.map((x) => obj(L.shares.get(x.id)!))).toEqual([{ a: 1, b: 0, c: 0 }, { a: 0, b: 1, c: 0 }, { a: 0, b: 0, c: 1 }]);
    expect(obj(L.owes)).toEqual({ a: 1, b: 1, c: 1 });
    expect(obj(L.luck)).toEqual({ a: 1, b: 1, c: 1 });
    // luckAt reproduces each expense's shares on its own (what its details show)
    expect(obj(expenseShares(xs[1]!, order, undefined, new Map(L.luckAt.get("x2"))))).toEqual({ a: 0, b: 1, c: 0 });
  });
  it("the trip of 2026-10-03: 9 people, 5 receipts split equally — shares at most 1 gr apart", () => {
    const ids = ["yu", "tom", "f1", "f2", "lika", "anton", "serg", "ulj", "oks"];
    const amounts: [number, string][] = [[352.35, "tom"], [128.06, "serg"], [714.13, "f2"], [200, "anton"], [85.37, "f1"]];
    const expenses = amounts.map(([amount, paid_by], k) => X({ id: `e${k}`, amount, paid_by, created: `2026-10-0${k + 1} 10:00:00.000Z` }));
    const L = computeLedger({ people: ids.map((id) => ({ id })), expenses, claims: [] });
    const owes = [...L.owes.values()];
    expect(owes.reduce((s, v) => s + v, 0)).toBe(147991);
    // exactly 164,43(4) each: four people pay 164,44, five 164,43 (it used to be 164,41…164,45)
    expect(Math.max(...owes) - Math.min(...owes)).toBe(1);
    expect(owes.filter((v) => v === 16444)).toHaveLength(4);
  });
  it("claims rows and «авто» use the same luck", () => {
    const L = computeLedger({
      people,
      expenses: [
        X({ id: "1", amount: 0.01, created: "2026-10-01 10:00:00.000Z" }),
        X({ id: "2", amount: 10, split_mode: "amounts", split_amounts: { a: 999, b: null, c: null }, created: "2026-10-01 11:00:00.000Z" }),
      ],
      claims: [],
    });
    // 1 gr left for b and c: b (no leftover yet, list order before c)
    expect(obj(L.shares.get("2")!)).toEqual({ a: 999, b: 1, c: 0 });
  });
});

describe("groups («рассчитываемся вместе»)", () => {
  const P = (wallets: Record<string, string>): Pick<Person, "id" | "wallet">[] => order.map((id) => ({ id, wallet: wallets[id] ?? "" }));
  it("balances stay per person, a group's add up into its head; transfers only between groups", () => {
    // a paid 90 for everyone; b settles together with c (c transfers)
    const L = computeLedger({ people: P({ b: "c" }), expenses: [X({ amount: 90 })], claims: [] });
    expect(obj(L.bal)).toEqual({ a: 6000, b: -3000, c: -3000 });
    expect(obj(L.gbal)).toEqual({ a: 6000, c: -6000 });
    expect(L.members.get("c")).toEqual(["b", "c"]);
    expect(settle(L.gbal)).toEqual([{ from: "c", to: "a", g: 6000 }]);
  });
  it("a transfer by any member counts for the group", () => {
    const L = computeLedger({ people: P({ b: "c" }), expenses: [X({ amount: 90 })], claims: [], settlements: [{ from: "b", to: "a", amount: 2000 }] });
    expect(obj(L.gbal)).toEqual({ a: 4000, c: -4000 });
  });
  it("money inside a group never shows up as a transfer", () => {
    // c paid for a and b; a and c are a group: only b owes
    const L = computeLedger({ people: P({ a: "c" }), expenses: [X({ amount: 90, paid_by: "c" })], claims: [] });
    expect(settle(L.gbal)).toEqual([{ from: "b", to: "c", g: 3000 }]);
  });
  it("chains resolve, cycles and deleted heads count as alone", () => {
    expect(obj(groupHeads(P({ a: "b", b: "c" })))).toEqual({ a: "c", b: "c", c: "c" });
    expect(obj(groupHeads(P({ a: "b", b: "a" })))).toEqual({ a: "a", b: "b", c: "c" });
    expect(obj(groupHeads(P({ a: "a" })))).toEqual({ a: "a", b: "b", c: "c" });
    expect(obj(groupHeads(P({ a: "deleted0000000" })))).toEqual({ a: "a", b: "b", c: "c" });
  });
});

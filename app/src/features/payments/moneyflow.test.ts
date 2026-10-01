// What a typed amount becomes on the server (PLN with 2 decimals) and in the
// ledger (grosze): the path from the payment form to the balances.
import { describe, expect, it } from "vitest";
import { computeLedger } from "../../lib/ledger";
import { grosze, parseAmount, parseG } from "../../lib/money";
import type { Expense } from "../../lib/types";
import { amountsState, buildSave, cleanAmountInput, formAmountG, initialForm, type PayForm } from "./logic";

const order = ["a", "b", "c"];
const now = new Date(2026, 9, 1, 15);
const form = (over: Partial<PayForm> = {}): PayForm => ({ ...initialForm(null, "a", order, now), ...over });
const save = (f: PayForm, x: Expense | null = null) => buildSave(f, x, { order, now });
const savedAmount = (typed: string) => {
  const r = save(form({ amount: typed }));
  return r.ok ? (r.data.amount as number) : r.error;
};

describe("typed amount -> saved amount", () => {
  it.each([
    ["12,50", 12.5],
    ["12.5", 12.5],
    ["12", 12],
    [" 1 234,56 ", 1234.56],
    ["1 234,56", 1234.56], // no-break space, as Intl prints it
    ["12,50 zł", 12.5],
    ["0,01", 0.01],
    ["12,345", 12.35], // half up at the third decimal
    ["1,005", 1.01], // float math would give 1,00
    ["999999,99", 999999.99],
  ])("%j -> %f", (typed, pln) => {
    expect(savedAmount(typed)).toBe(pln);
  });
  it.each([
    ["-5", "Проверь сумму"],
    ["0", "Проверь сумму"],
    ["0,001", "Проверь сумму"],
    ["1,2,3", "Проверь сумму"],
    ["1.234,56", "Проверь сумму"],
    ["abc", "Проверь сумму"],
    ["", "Добавь фото чека или введи сумму"],
    ["1000000,01", "Слишком большая сумма"],
  ])("%j is refused (%s)", (typed, err) => {
    expect(savedAmount(typed)).toBe(err);
  });
  it("the input drops what can't be part of an amount (no minus sign at all)", () => {
    expect(cleanAmountInput("-12,5zł")).toBe("12,5");
  });
  it("the saved PLN number is exactly the grosze the form showed", () => {
    for (let g = 1; g <= 100_000; g += 37) {
      const typed = `${Math.floor(g / 100)},${String(g % 100).padStart(2, "0")}`;
      expect(formAmountG({ amount: typed })).toBe(g);
      expect(grosze(parseAmount(typed))).toBe(g);
      expect(parseG(typed)).toBe(g);
    }
  });
});

describe("«Суммами» -> split_amounts in grosze", () => {
  it("decimals in both separators, «авто» as null", () => {
    const r = save(form({ amount: "30", mode: "amounts", part: ["a", "b", "c"], amts: { a: "10,5", b: "7.25" } }));
    expect(r).toMatchObject({ ok: true, data: { amount: 30, split_amounts: { a: 1050, b: 725, c: null } } });
  });
  it("more than the amount is refused; less without «авто» is refused", () => {
    expect(save(form({ amount: "10", mode: "amounts", amts: { a: "6", b: "6", c: "" } }))).toMatchObject({ ok: false, field: "amounts" });
    expect(save(form({ amount: "10", mode: "amounts", amts: { a: "3", b: "3", c: "3" } }))).toMatchObject({ ok: false, field: "amounts" });
  });
  it("what the form previews for «авто» is what the ledger charges", () => {
    const f = form({ amount: "100", mode: "amounts", amts: { a: "33,33" } });
    const st = amountsState(order, f.amts, formAmountG(f), false);
    const r = save(f);
    if (!r.ok) throw new Error(r.error);
    const x = { id: "x", ...r.data } as Expense;
    const L = computeLedger({ people: order.map((id) => ({ id })), expenses: [x], claims: [] });
    expect(L.shares.get("x")!.get("b")).toBe(st.auto.get("b"));
    expect(L.shares.get("x")!.get("c")).toBe(st.auto.get("c"));
    expect(obj(L.shares.get("x")!)).toEqual({ a: 3333, b: 3334, c: 3333 });
  });
});

const obj = (m: Map<string, number>) => Object.fromEntries(m);

describe("editing a saved payment", () => {
  const saved: Expense = {
    id: "x1", amount: 120, paid_by: "a", split_between: [], split_mode: "equal", split_amounts: null,
    receipt: "r_abc.jpg", lines: [{ text: "A", price: 120 }], scan_status: "done", spent_at: "2026-10-01 10:00:00.000Z",
  };
  it("clearing the amount is refused (it would silently drop out of the balances)", () => {
    const f = { ...initialForm(saved, "a", order), amount: "", touched: { amount: true } };
    expect(save(f, saved)).toMatchObject({ ok: false, error: "Введи сумму", field: "amount" });
  });
  it("…unless the receipt is being read right now or a new receipt is attached (the scan fills a 0 amount)", () => {
    const scanning = { ...saved, scan_status: "pending" as const };
    expect(save({ ...initialForm(scanning, "a", order), amount: "", touched: { amount: true } }, scanning)).toMatchObject({ ok: true, data: { amount: 0 } });
    const file = new File([new Uint8Array(10)], "r.jpg", { type: "image/jpeg" });
    expect(save({ ...initialForm(saved, "a", order), amount: "", touched: { amount: true }, file }, saved)).toMatchObject({ ok: true });
  });
  it("a changed amount is sent as PLN with 2 decimals", () => {
    const f = { ...initialForm(saved, "a", order), amount: "119,999", touched: { amount: true } };
    // 119,999 -> 120,00 = unchanged -> nothing to send
    expect(save(f, saved)).toMatchObject({ ok: true, changed: false });
    expect(save({ ...f, amount: "119,99" }, saved)).toMatchObject({ ok: true, data: { amount: 119.99 } });
  });
  it("payer not among the people splitting it is allowed: they get everything back", () => {
    const r = save(form({ amount: "10", paid: "a", part: ["b", "c"] }));
    if (!r.ok) throw new Error(r.error);
    const L = computeLedger({ people: order.map((id) => ({ id })), expenses: [{ id: "x", ...r.data } as Expense], claims: [] });
    expect(obj(L.bal)).toEqual({ a: 1000, b: -500, c: -500 });
  });
});

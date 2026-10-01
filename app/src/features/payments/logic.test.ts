import { describe, expect, it } from "vitest";
import type { Expense } from "../../lib/types";
import {
  amountsState, buildSave, claimProgress, claimsAvailable, claimsHint, groupLines, initialForm,
  type PayForm, scanView, spentAt, splitLabel, syncUntouched, waitingText,
} from "./logic";

const order = ["a", "b", "c", "d"];
const nb = (s: string) => s.replace(/[  ]/g, " ");
const form = (over: Partial<PayForm> = {}): PayForm => ({ ...initialForm(null, "a", order, new Date(2026, 9, 1, 15)), ...over });
const jpeg = () => new File([new Uint8Array(10)], "r.jpg", { type: "image/jpeg" });
const now = new Date(2026, 9, 1, 15);

describe("«Суммами» reconciliation", () => {
  it("fixed parts + the rest evenly between «авто»", () => {
    const st = amountsState(["a", "b", "c"], { a: "50", b: "", c: "" }, 10000, false);
    expect(st).toMatchObject({ fixed: 5000, total: 10000, rem: 5000, autos: ["b", "c"], err: "" });
    expect([...st.auto]).toEqual([["b", 2500], ["c", 2500]]);
  });
  it("rounding leftovers go to the first «авто»", () => {
    const st = amountsState(["a", "b", "c"], {}, 1000, false);
    expect([...st.auto.values()]).toEqual([334, 333, 333]);
  });
  it("must add up when nobody is «авто»", () => {
    expect(nb(amountsState(["a", "b"], { a: "30", b: "30" }, 10000, false).err)).toBe("Остаток 40,00 zł — допиши или оставь кого-то на «авто»");
    expect(nb(amountsState(["a", "b"], { a: "60", b: "50" }, 10000, false).err)).toBe("Расписано больше суммы на 10,00 zł");
    expect(amountsState(["a", "b"], { a: "60", b: "40" }, 10000, false).err).toBe("");
  });
  it("without a total the parts are the total; with a photo someone must stay «авто»", () => {
    expect(amountsState(["a", "b"], { a: "12,50", b: "7.5" }, 0, false)).toMatchObject({ total: 2000, rem: 0, err: "" });
    expect(amountsState(["a", "b"], { a: "12", b: "" }, 0, false).err).toBe("Впиши сумму");
    expect(amountsState(["a", "b"], { a: "12", b: "" }, 0, true).err).toBe("");
    expect(amountsState(["a", "b"], { a: "12", b: "8" }, 0, true).err).toMatch(/«авто»/);
  });
  it("flags bad numbers and empty participants", () => {
    expect(amountsState(["a"], { a: "12x" }, 1000, false)).toMatchObject({ bad: ["a"], err: "Проверь суммы" });
    expect(amountsState([], {}, 1000, false).err).toBe("Отметь, на кого делим");
  });
});

describe("save payload", () => {
  it("new payment with a photo only: amount 0, the scan fills the rest", () => {
    const r = buildSave(form({ file: jpeg() }), null, { order, now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ amount: 0, title: "", category: "", paid_by: "a", split_between: [], split_mode: "equal", split_amounts: null });
    expect(r.data.receipt).toBeInstanceOf(File);
  });
  it("needs a photo or an amount", () => {
    expect(buildSave(form(), null, { order, now })).toMatchObject({ ok: false, error: "Добавь фото чека или введи сумму" });
    expect(buildSave(form({ amount: "0" }), null, { order, now })).toMatchObject({ ok: false, error: "Проверь сумму" });
    // a PDF is never read: it needs an amount
    const pdf = new File([new Uint8Array(1)], "r.pdf", { type: "application/pdf" });
    expect(buildSave(form({ file: pdf }), null, { order, now })).toMatchObject({ ok: false, error: "Введи сумму" });
  });
  it("amounts mode without a total sends the sum of the parts", () => {
    const r = buildSave(form({ mode: "amounts", part: ["a", "b"], amts: { a: "10", b: "5,5" } }), null, { order, now });
    expect(r).toMatchObject({ ok: true, data: { amount: 15.5, split_between: ["a", "b"], split_mode: "amounts", split_amounts: { a: 1000, b: 550 } } });
  });
  it("amounts mode keeps «авто» as null and blocks when it doesn't add up", () => {
    const ok = buildSave(form({ amount: "100", mode: "amounts", amts: { a: "40" } }), null, { order, now });
    expect(ok).toMatchObject({ ok: true, data: { split_amounts: { a: 4000, b: null, c: null, d: null } } });
    const bad = buildSave(form({ amount: "100", mode: "amounts", amts: { a: "40", b: "60", c: "1", d: "0" } }), null, { order, now });
    expect(bad).toMatchObject({ ok: false, field: "amounts" });
  });
  const saved: Expense = {
    id: "x1", amount: 352.35, title: "Lidl", category: "Фрукты", paid_by: "a", split_between: [],
    receipt: "r_abc.jpg", split_mode: "equal", split_amounts: null, spent_at: "2026-10-01 10:00:00.000Z",
    lines: [{ text: "A", price: 1 }], scan_status: "done",
  };
  it("edits send only what changed", () => {
    const f = initialForm(saved, "a", order);
    expect(buildSave(f, saved, { order, now })).toMatchObject({ ok: true, changed: false, data: {} });
    const r = buildSave({ ...f, paid: "b", part: ["a", "b"] }, saved, { order, now });
    expect(r).toMatchObject({ ok: true, data: { paid_by: "b", split_between: ["a", "b"] } });
    if (r.ok) expect(Object.keys(r.data).sort()).toEqual(["paid_by", "split_between"]);
  });
  it("untouched fields are not sent even if the form shows older values", () => {
    const f = { ...initialForm({ ...saved, amount: 0, title: "" }, "a", order) };
    const r = buildSave(f, saved, { order, now });
    expect(r).toMatchObject({ ok: true, changed: false });
  });
  it("a new receipt resets lines, claims mode and asks to drop claims", () => {
    const x = { ...saved, split_mode: "claims" as const };
    const f = { ...initialForm(x, "a", order), file: jpeg() };
    const r = buildSave(f, x, { order, now });
    expect(r).toMatchObject({ ok: true, dropClaims: true, data: { lines: null, scan_error: "", split_mode: "equal" } });
  });
  it("removing the receipt sends null", () => {
    const f = { ...initialForm(saved, "a", order), removeFile: true };
    expect(buildSave(f, saved, { order, now })).toMatchObject({ ok: true, data: { receipt: null } });
  });
});

describe("form sync and helpers", () => {
  it("takes server values only for untouched fields", () => {
    const f = { ...form({ file: jpeg() }), title: "Мой", touched: { title: true } };
    const x: Expense = { id: "x", amount: 154.07, title: "Auchan", category: "Бакалея", paid_by: "a" };
    expect(syncUntouched(f, x)).toMatchObject({ amount: "154,07", title: "Мой", cat: "Бакалея" });
  });
  it("dates: unchanged -> nothing, today -> now, past day -> noon", () => {
    expect(spentAt("2026-09-30", "2026-09-30", now)).toBeUndefined();
    expect(spentAt("2026-10-01", null, now)).toBe(now.toISOString());
    expect(spentAt("2026-09-28", "2026-09-30", now)).toBe(new Date(2026, 8, 28, 12).toISOString());
  });
  it("scan status and split labels", () => {
    expect(scanView({ id: "1", amount: 0, paid_by: "a", scan_status: "running", receipt: "a.jpg" })).toEqual({ kind: "scanning" });
    expect(scanView({ id: "1", amount: 0, paid_by: "a", scan_status: "failed", scan_error: "unsupported_format" })).toEqual({ kind: "failed", retry: false });
    expect(scanView({ id: "1", amount: 1, paid_by: "a", lines: [{ text: "x" }], scan_error: "lines_mismatch" })).toEqual({ kind: "mismatch" });
    expect(scanView({ id: "1", amount: 1, paid_by: "a", receipt: "old.jpeg" })).toEqual({ kind: "unread" });
    expect(scanView({ id: "1", amount: 1, paid_by: "a", receipt: "doc.pdf" })).toEqual({ kind: "none" });
    expect(splitLabel({ id: "1", amount: 1, paid_by: "a" }, order)).toBe("поровну на 4");
    expect(splitLabel({ id: "1", amount: 1, paid_by: "a", split_between: ["a", "b"] }, order)).toBe("поровну на 2");
    expect(splitLabel({ id: "1", amount: 1, paid_by: "a", split_mode: "amounts", split_amounts: { a: 1 } }, order)).toBe("суммами");
    expect(splitLabel({ id: "1", amount: 1, paid_by: "a", split_mode: "claims", lines: [{ text: "x" }] }, order)).toBe("по чеку");
  });
  it("«По чеку» availability", () => {
    const x: Expense = { id: "1", amount: 1, paid_by: "a", receipt: "a.jpg", lines: [{ text: "x", price: 1 }] };
    expect(claimsAvailable(form(), x)).toBe(true);
    expect(claimsAvailable(form({ file: jpeg() }), x)).toBe(false);
    expect(claimsAvailable(form(), { ...x, scan_error: "lines_mismatch" })).toBe(false);
    expect(claimsHint(form(), { ...x, lines: null, scan_status: "pending" })).toBe("Появится, когда чек распознается");
    expect(claimsHint(form(), { ...x, scan_error: "lines_mismatch" })).toMatch(/неточные/);
    expect(claimsHint(form(), null)).toMatch(/Нужно фото/);
  });
});

describe("receipt lines", () => {
  const lines = [
    { text: "Pomidory", price: 26.42, category: "Овощи и зелень", item_id: "tom" },
    { text: "OPUST Pomidory", price: -14, category: "Овощи и зелень" },
    { text: "", price: 3 },
    { text: "Banany", price: 17.31, category: "Фрукты" },
    { text: "Folia", price: 7.69, category: null },
    { text: "Rabat", price: -1 },
    { text: "Rabat 2", price: -0.5 },
  ];
  it("folds a discount into the line before it, keeps indices, groups by category order", () => {
    const { groups, rows, categorized } = groupLines(lines);
    expect(categorized).toBe(true);
    expect(rows.map((r) => [r.idx, r.extra, r.g])).toEqual([
      [0, [1], 1242], [3, [], 1731], [4, [5], 669], [6, [], -50],
    ]);
    expect(groups.map((g) => [g.cat, g.g])).toEqual([["Овощи и зелень", 1242], ["Фрукты", 1731], ["Другое", 619]]);
    expect(rows[0]).toMatchObject({ discount: -1400, itemId: "tom" });
  });
  it("no categories -> one group without a name", () => {
    const { groups } = groupLines([{ text: "a", price: 1 }, { text: "b", price: 2 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ cat: "", g: 300 });
  });
  it("claim progress counts claimed rows (net) and who is missing", () => {
    const { rows } = groupLines(lines);
    const byLine = new Map([[0, ["a"]], [3, ["a", "b"]]]);
    const x: Expense = { id: "1", amount: 35.92, paid_by: "a" };
    expect(claimProgress(x, rows, byLine, order)).toEqual({ got: 2973, all: 3592, waiting: ["c", "d"] });
    expect(waitingText(["Оля"])).toBe("ждём Оля");
    expect(waitingText(["A", "B", "C", "D"])).toBe("ждём A, B и ещё 2");
    expect(waitingText([])).toBe("все отметились");
  });
});

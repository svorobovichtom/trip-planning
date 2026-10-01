import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/pb", () => ({ pb: {} }));
const { buildCsv } = await import("./csv");
import type { Expense, Settlement } from "../../lib/types";

const people = [
  { id: "a", name: "Аня" },
  { id: "b", name: "Боря" },
  { id: "c", name: "Вика" },
];
const X = (p: Partial<Expense>): Expense => ({ id: "x", amount: 0, paid_by: "a", ...p });

describe("buildCsv", () => {
  const expenses = [
    X({ id: "1", title: "Lidl", amount: 90, paid_by: "a", created: "2026-10-01 10:00:00.000Z", category: "Бакалея", receipt: "r.jpg" }),
    X({ id: "2", title: "Бензин", amount: 30, paid_by: "b", created: "2026-10-01 11:00:00.000Z", split_mode: "amounts", split_amounts: { b: 1000, c: null } }),
    X({
      id: "3", title: "Żabka", amount: 10, paid_by: "c", created: "2026-10-01 12:00:00.000Z", split_mode: "claims",
      lines: [{ text: "Пиво", price: 6 }, { text: "Чипсы", price: 4 }],
    }),
  ];
  const settlements: Settlement[] = [
    { id: "s1", from: "b", to: "a", amount: 1000, note: 'BLIK "быстро"', created: "2026-10-02 09:05:00.000Z" },
    { id: "tmp1", from: "c", to: "a", amount: 1, tmp: true },
  ];
  const csv = buildCsv({ people, expenses, claims: [{ expense: "3", line: 0, person: "a" }], settlements }, (x) => `https://f/${x.receipt}`);
  const lines = csv.slice(1).split("\r\n");

  it("is UTF-8 with BOM, ; separated, quoted", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe('"Дата";"Что";"Категория";"Сумма";"Валюта";"Платил";"Деление";"На кого";"Аня";"Боря";"Вика";"Чек"');
  });
  it("expense rows: split mode and per-person shares from the ledger", () => {
    expect(lines[1]).toBe('"2026-10-01";"Lidl";"Бакалея";"90,00";"PLN";"Аня";"Поровну";"все";"30,00";"30,00";"30,00";"https://f/r.jpg"');
    expect(lines[2]).toBe('"2026-10-01";"Бензин";"";"30,00";"PLN";"Боря";"Суммами";"Боря, Вика";"";"10,00";"20,00";""');
    // Пиво (6) to Аня who claimed it; Чипсы (4) evenly: 1,34 / 1,33 / 1,33
    expect(lines[3]).toBe('"2026-10-01";"Żabka";"";"10,00";"PLN";"Вика";"По чеку";"все";"7,34";"1,33";"1,33";""');
  });
  it("settlements section (server-confirmed only), balances after transfers, what's left", () => {
    const rest = lines.slice(4);
    expect(rest[0]).toBe("");
    expect(rest[1]).toBe('"Переводы сделаны"');
    expect(rest[2]).toBe('"Когда";"Кто";"Кому";"Сумма";"Комментарий"');
    expect(rest[3]).toMatch(/^"2026-10-02 \d\d:05";"Боря";"Аня";"10,00";"BLIK ""быстро"""$/);
    expect(rest[4]).toBe("");
    expect(rest[5]).toBe('"Кто";"Заплатил";"Доля";"Перевёл";"Получил";"Баланс"');
    // Аня: paid 90, share 30+0+7,34 = 37,34, received 10 -> 42,66
    expect(rest[6]).toBe('"Аня";"90,00";"37,34";"0,00";"10,00";"42,66"');
    expect(rest[7]).toBe('"Боря";"30,00";"41,33";"10,00";"0,00";"-1,33"');
    expect(rest[8]).toBe('"Вика";"10,00";"51,33";"0,00";"0,00";"-41,33"');
    expect(rest[10]).toBe('"Осталось перевести"');
    expect(rest.slice(12)).toEqual(['"Вика";"Аня";"41,33"', '"Боря";"Аня";"1,33"']);
  });
});

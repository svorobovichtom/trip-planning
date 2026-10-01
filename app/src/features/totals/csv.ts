// CSV export for Excel/Sheets: UTF-8 with BOM, ";" separated, decimal comma
// (opens as columns in RU/PL locales). Sections, separated by a blank row:
//   1. expenses: date, what, category, amount, payer, split mode, for whom,
//      then one column per person with their share (from the ledger), receipt
//   2. «Переводы сделаны»: settlements (who → whom, amount, when)
//   3. balances: paid, share, sent, received, balance after transfers
//   4. «Осталось перевести»: what settle() suggests now
// buildCsv is pure (the caller passes how to link a receipt); exportCsv
// builds it from the store and saves the file.
import { computeLedger, settle, splitModeOf } from "../../lib/ledger";
import { grosze } from "../../lib/money";
import { pb } from "../../lib/pb";
import { dataStore } from "../../lib/stores";
import type { Claim, Expense, Person, Settlement } from "../../lib/types";

export interface CsvData {
  people: readonly Person[];
  expenses: Iterable<Expense>;
  claims: Iterable<Pick<Claim, "expense" | "line" | "person">>;
  settlements: Iterable<Settlement>;
}

export const MODE_LABEL = { equal: "Поровну", amounts: "Суммами", claims: "По чеку" } as const;

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const timeStr = (d: Date) => `${dayStr(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const parseDate = (s?: string) => {
  const d = s ? new Date(String(s).replace(" ", "T")) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};
const dec = (g: number) => (g / 100).toFixed(2).replace(".", ",");
const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function buildCsv(data: CsvData, receiptUrl: (x: Expense) => string = () => ""): string {
  const { people } = data;
  const order = people.map((p) => p.id);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const name = (id: string) => names.get(id) ?? "";
  const xs = [...data.expenses].sort((a, b) => String(a.created ?? "").localeCompare(String(b.created ?? "")));
  const ts = [...data.settlements].filter((t) => !t.tmp).sort((a, b) => String(a.created ?? "").localeCompare(String(b.created ?? "")));
  const L = computeLedger({ people, expenses: xs, claims: data.claims, settlements: ts });

  const rows: unknown[][] = [
    ["Дата", "Что", "Категория", "Сумма", "Валюта", "Платил", "Деление", "На кого", ...people.map((p) => p.name), "Чек"],
  ];
  for (const x of xs) {
    const sh = L.shares.get(x.id) ?? new Map<string, number>();
    const who = order.filter((id) => (sh.get(id) ?? 0) !== 0);
    const d = parseDate(x.spent_at || x.created);
    rows.push([
      d ? dayStr(d) : "",
      x.title,
      x.category,
      dec(grosze(x.amount)),
      x.currency || "PLN",
      name(x.paid_by),
      MODE_LABEL[splitModeOf(x, order)],
      !who.length ? "" : who.length === order.length ? "все" : who.map(name).join(", "),
      ...order.map((id) => (sh.get(id) ? dec(sh.get(id)!) : "")),
      x.receipt ? receiptUrl(x) : "",
    ]);
  }

  rows.push([]);
  rows.push(["Переводы сделаны"]);
  rows.push(["Когда", "Кто", "Кому", "Сумма", "Комментарий"]);
  for (const t of ts) {
    const d = parseDate(t.created);
    rows.push([d ? timeStr(d) : "", name(t.from), name(t.to), dec(Math.round(t.amount)), t.note ?? ""]);
  }

  rows.push([]);
  rows.push(["Кто", "Заплатил", "Доля", "Перевёл", "Получил", "Баланс"]);
  for (const p of people) {
    const g = (m: Map<string, number>) => dec(m.get(p.id) ?? 0);
    rows.push([p.name, g(L.paid), g(L.owes), g(L.sent), g(L.received), g(L.bal)]);
  }

  rows.push([]);
  rows.push(["Осталось перевести"]);
  rows.push(["Кто", "Кому", "Сумма"]);
  for (const t of settle(L.bal)) rows.push([name(t.from), name(t.to), dec(t.g)]);

  return `\uFEFF${rows.map((r) => r.map(q).join(";")).join("\r\n")}`;
}

export function exportCsv(): void {
  const { people, expenses, claims, settlements } = dataStore.get();
  const csv = buildCsv(
    { people, expenses: expenses.values(), claims: claims.values(), settlements: settlements.values() },
    (x) => (x.receipt ? pb.files.getURL(x, x.receipt) : ""),
  );
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "trip-expenses.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// CSV export of expenses + balances (port of the legacy exportCsv).
// TODO(totals): add per-line claims / split modes if the group wants them.
import { computeLedger } from "../../lib/ledger";
import { pb } from "../../lib/pb";
import { dataStore } from "../../lib/stores";

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayStr = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDate = (s?: string) => (s ? new Date(String(s).replace(" ", "T")) : null);
const dec = (g: number) => (g / 100).toFixed(2).replace(".", ",");

export function buildCsv(): string {
  const { people, expenses, claims } = dataStore.get();
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows: unknown[][] = [["Дата", "Что", "Категория", "Сумма", "Валюта", "Платил", "На кого", "Чек"]];
  const xs = [...expenses.values()].sort((a, b) => String(a.created ?? "").localeCompare(String(b.created ?? "")));
  for (const x of xs) {
    const ids = (x.split_between ?? []).filter((id) => people.some((p) => p.id === id));
    const d = parseDate(x.spent_at || x.created);
    rows.push([
      d && !Number.isNaN(d.getTime()) ? dayStr(d) : "",
      x.title,
      x.category,
      String(x.amount).replace(".", ","),
      x.currency || "PLN",
      name(x.paid_by),
      ids.length ? ids.map(name).join(", ") : "все",
      x.receipt ? pb.files.getURL(x, x.receipt) : "",
    ]);
  }
  const L = computeLedger({ people, expenses: expenses.values(), claims: claims.values() });
  rows.push([]);
  rows.push(["Кто", "Заплатил", "Доля", "Баланс"]);
  for (const p of people) rows.push([p.name, dec(L.paid.get(p.id) ?? 0), dec(L.owes.get(p.id) ?? 0), dec(L.bal.get(p.id) ?? 0)]);
  return `﻿${rows.map((r) => r.map(q).join(";")).join("\r\n")}`;
}

export function exportCsv(): void {
  const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "trip-expenses.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

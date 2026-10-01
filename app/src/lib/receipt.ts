// Receipt lines (from the background scan) against the shopping list: what
// each bought item really cost and how much of it came, plus lines that are
// not on the list («Сверх списка»).

import { grosze } from "./money";
import type { Expense, Item, ReceiptLine } from "./types";

export const UNIT: Record<string, string> = { kg: "кг", g: "г", l: "л", ml: "мл", szt: "шт" };
const fmtQ = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

export interface LineRef {
  expense: Expense;
  index: number;
  line: ReceiptLine;
}

export interface ItemActual {
  /** sum of matched line prices, grosze */
  g: number;
  lines: ReceiptLine[];
}

export function receiptLines(expenses: Iterable<Expense>): LineRef[] {
  const out: LineRef[] = [];
  for (const expense of expenses) {
    if (!Array.isArray(expense.lines)) continue;
    expense.lines.forEach((line, index) => {
      if (line && line.text) out.push({ expense, index, line });
    });
  }
  return out;
}

export function aggregateLines(
  expenses: Iterable<Expense>,
  hasItem: (id: string) => boolean,
): { byItem: Map<string, ItemActual>; extra: LineRef[] } {
  const byItem = new Map<string, ItemActual>();
  const extra: LineRef[] = [];
  for (const r of receiptLines(expenses)) {
    const id = r.line.item_id;
    if (id && hasItem(id)) {
      let a = byItem.get(id);
      if (!a) byItem.set(id, (a = { g: 0, lines: [] }));
      a.g += grosze(r.line.price);
      a.lines.push(r.line);
    } else extra.push(r);
  }
  return { byItem, extra };
}

/** "1,2 кг", "× 3", or "" for a single piece / unknown. */
export function lineQty(l: ReceiptLine): string {
  const q = Number(l.qty);
  if (!(q > 0)) return "";
  const u = l.unit ? UNIT[l.unit] : undefined;
  if (u) return `${fmtQ.format(q)} ${u}`;
  return q !== 1 ? `× ${fmtQ.format(q)}` : "";
}

/** Sum of the matching lines when they share a unit; otherwise the planned qty. */
export function actualQty(it: Pick<Item, "qty">, a: ItemActual | undefined): string {
  const L = a ? a.lines.filter((l) => Number(l.price) > 0) : [];
  if (!L.length) return it.qty || "";
  const u0 = L[0]!.unit;
  const u = u0 ? UNIT[u0] : undefined;
  if (!u || L.some((l) => l.unit !== u0 || !(Number(l.qty) > 0))) return it.qty || "";
  const sum = Math.round(L.reduce((s, l) => s + Number(l.qty), 0) * 1000) / 1000;
  return `${fmtQ.format(sum)} ${u}`;
}

// Derived data shared by features. Memoized on the store slices they read.
import { useMemo } from "react";
import { computeLedger, type Ledger, type Luck } from "./ledger";
import { grosze } from "./money";
import { aggregateLines } from "./receipt";
import { useClaims, useExpenses, useItems, usePeople, useSettlements } from "./stores";
import type { Expense, Item } from "./types";

/** Full ledger (balances after transfers, shares per expense, categories). */
export function useLedger(): Ledger {
  const people = usePeople();
  const expenses = useExpenses();
  const claims = useClaims();
  const settlements = useSettlements();
  return useMemo(
    () => computeLedger({ people, expenses: expenses.values(), claims: claims.values(), settlements: settlements.values() }),
    [people, expenses, claims, settlements],
  );
}

/**
 * Who gets the leftover grosze when expense `id` is split: its luck in the
 * ledger (a new expense comes last). Shared — pass a copy to splitEven.
 */
export function useLuck(id?: string): Luck {
  const L = useLedger();
  return (id && L.luckAt.get(id)) || L.luck;
}

/** Sum of all expense amounts, grosze. */
export function useTotalG(): number {
  const expenses = useExpenses();
  return useMemo(() => {
    let t = 0;
    for (const x of expenses.values()) t += grosze(x.amount);
    return t;
  }, [expenses]);
}

/** Expenses newest first. */
export function useSortedExpenses(): Expense[] {
  const expenses = useExpenses();
  return useMemo(() => [...expenses.values()].sort((a, b) => String(b.created ?? "").localeCompare(String(a.created ?? ""))), [expenses]);
}

export interface Section {
  name: string;
  items: Item[];
}

/** List sections in first-seen order; items by sort, then created. */
export function useSections(): Section[] {
  const items = useItems();
  return useMemo(() => {
    const order: string[] = [];
    const by = new Map<string, Item[]>();
    const sorted = [...items.values()].sort((a, b) => a.sort - b.sort || String(a.created ?? "").localeCompare(String(b.created ?? "")));
    for (const it of sorted) {
      let arr = by.get(it.section);
      if (!arr) {
        by.set(it.section, (arr = []));
        order.push(it.section);
      }
      arr.push(it);
    }
    return order.map((name) => ({ name, items: by.get(name)! }));
  }, [items]);
}

export function useListStats(): { done: number; total: number } {
  const items = useItems();
  return useMemo(() => {
    let done = 0;
    for (const it of items.values()) if (it.done) done++;
    return { done, total: items.size };
  }, [items]);
}

/** What each item really cost (receipt lines with item_id) + lines beyond the list. */
export function useReceiptMatch() {
  const items = useItems();
  const expenses = useExpenses();
  return useMemo(() => aggregateLines(expenses.values(), (id) => items.has(id)), [items, expenses]);
}

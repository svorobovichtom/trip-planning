// Payment writes. Creates, edits and deletes need the network (a receipt
// upload can't wait in the offline queue); claims are optimistic.

import { requireWriter } from "../../lib/actions";
import { haptic } from "../../lib/haptics";
import { errMsg, isNetErr, pb } from "../../lib/pb";
import { dataStore } from "../../lib/stores";
import { removeLocal, upsertLocal } from "../../lib/sync";
import type { Claim, Expense } from "../../lib/types";
import { toast } from "../../ui/toast";

const OFFLINE = "Нет связи — платёж не сохранён, форма осталась";

export const claimsOf = (expenseId: string): Claim[] => [...dataStore.get().claims.values()].filter((c) => c.expense === expenseId);

/** Creates or updates; resolves the saved record, or null (the form stays open). */
export async function saveExpense(x: Expense | null, data: Record<string, unknown>, dropClaims: boolean): Promise<Expense | null> {
  if (!requireWriter()) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    toast(OFFLINE);
    return null;
  }
  try {
    const rec = x
      ? await pb.collection("expenses").update<Expense>(x.id, data)
      : await pb.collection("expenses").create<Expense>(data);
    upsertLocal("expenses", rec);
    if (x && dropClaims) {
      for (const c of claimsOf(x.id)) {
        removeLocal("claims", c.id);
        if (!c.tmp) pb.collection("claims").delete(c.id).catch(() => {});
      }
    }
    return rec;
  } catch (e) {
    toast(isNetErr(e) ? OFFLINE : `Не сохранилось: ${errMsg(e)}`);
    return null;
  }
}

export async function deleteExpense(x: Expense): Promise<boolean> {
  if (!requireWriter()) return false;
  try {
    await pb.collection("expenses").delete(x.id);
  } catch (e) {
    if ((e as { status?: number })?.status !== 404) {
      toast(isNetErr(e) ? "Нет связи — не удалилось" : `Не удалилось: ${errMsg(e)}`);
      return false;
    }
  }
  removeLocal("expenses", x.id);
  for (const c of claimsOf(x.id)) removeLocal("claims", c.id);
  return true;
}

/** Ask the server to read the receipt (again). Explicit tap only. */
export async function rescan(x: Expense): Promise<void> {
  if (!requireWriter()) return;
  upsertLocal("expenses", { ...x, scan_status: "pending", scan_error: "" });
  try {
    upsertLocal("expenses", await pb.collection("expenses").update<Expense>(x.id, { scan_status: "pending", scan_error: "" }));
  } catch (e) {
    const cur = dataStore.get().expenses.get(x.id);
    if (cur) upsertLocal("expenses", { ...cur, scan_status: x.scan_status ?? "", scan_error: x.scan_error ?? "" });
    toast(isNetErr(e) ? "Нет связи" : `Не получилось: ${errMsg(e)}`);
  }
}

/** Small field change from the details view (e.g. switch to «По чеку»). */
export async function patchExpense(x: Expense, data: Partial<Expense>): Promise<boolean> {
  if (!requireWriter()) return false;
  upsertLocal("expenses", { ...x, ...data });
  try {
    upsertLocal("expenses", await pb.collection("expenses").update<Expense>(x.id, data));
    return true;
  } catch (e) {
    upsertLocal("expenses", x);
    toast(isNetErr(e) ? "Нет связи" : `Не получилось: ${errMsg(e)}`);
    return false;
  }
}

// ---------- claims ----------

const busy = new Set<string>();
const bk = (x: string, i: number, p: string) => `${x}:${i}:${p}`;

/**
 * Claims or unclaims a receipt row for `person`: the main line plus the
 * discount lines folded into it. Optimistic; the server's echo replaces the
 * temporary copies (sync.ts dedupes by expense+line+person).
 */
export async function toggleClaim(expenseId: string, lines: number[], person: string): Promise<void> {
  if (!requireWriter() || !lines.length) return;
  const main = lines[0]!;
  const key = bk(expenseId, main, person);
  if (busy.has(key)) return;
  busy.add(key);
  const all = claimsOf(expenseId).filter((c) => c.person === person);
  const mine = all.filter((c) => lines.includes(c.line));
  const on = all.some((c) => c.line === main);
  try {
    if (on) {
      for (const c of mine) removeLocal("claims", c.id);
      haptic();
      const res = await Promise.allSettled(mine.filter((c) => !c.tmp).map((c) => pb.collection("claims").delete(c.id)));
      const failed = res.find((r) => r.status === "rejected" && (r.reason as { status?: number })?.status !== 404);
      if (failed) {
        // put back the ones that are still there
        for (const [i, r] of res.entries()) if (r.status === "rejected") upsertLocal("claims", mine.filter((c) => !c.tmp)[i]!);
        const e = (failed as PromiseRejectedResult).reason;
        toast(isNetErr(e) ? "Нет связи — отметка не снялась" : `Не получилось: ${errMsg(e)}`);
      }
    } else {
      const missing = lines.filter((i) => !mine.some((c) => c.line === i));
      const tmps = missing.map((line) => ({ id: `tmp${Math.random().toString(36).slice(2)}`, tmp: true, expense: expenseId, line, person }));
      for (const t of tmps) upsertLocal("claims", t);
      haptic();
      const res = await Promise.allSettled(
        // line is always sent, including 0
        tmps.map((t) => pb.collection("claims").create<Claim>({ expense: expenseId, line: t.line, person })),
      );
      let err: unknown = null;
      res.forEach((r, i) => {
        const t = tmps[i]!;
        if (r.status === "fulfilled") upsertLocal("claims", r.value);
        else {
          removeLocal("claims", t.id);
          // 400 on the unique index = someone (another tab) already has it; reload brings it
          err ??= r.reason;
        }
      });
      if (err) toast(isNetErr(err) ? "Нет связи — отметка не сохранилась" : `Не получилось: ${errMsg(err)}`);
    }
  } finally {
    busy.delete(key);
  }
}

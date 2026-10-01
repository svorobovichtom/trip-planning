// «Переведено»: marking transfers between people as done, and undoing them.
// Optimistic (the balance moves at once); needs the network to stick — on
// failure the change is rolled back with a toast. Others get it over realtime.
import { requireWriter } from "../../lib/actions";
import { haptic } from "../../lib/haptics";
import { pb, errMsg, isNetErr } from "../../lib/pb";
import { dataStore } from "../../lib/stores";
import { removeLocal, upsertLocal } from "../../lib/sync";
import type { Settlement } from "../../lib/types";
import { toast } from "../../ui/toast";

/** Max one transfer: 1 000 000 zł, in grosze (the migration's max). */
export const MAX_G = 100_000_000;

export async function addSettlement(from: string, to: string, g: number, done: string): Promise<boolean> {
  if (!requireWriter()) return false;
  if (!dataStore.get().hasSettlements) {
    toast("Сервер ещё не умеет отмечать переводы");
    return false;
  }
  if (from === to || !Number.isInteger(g) || g < 1 || g > MAX_G) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    toast("Нет связи — перевод не отмечен");
    return false;
  }
  const tmp: Settlement = { id: `tmp${Math.random().toString(36).slice(2)}`, tmp: true, from, to, amount: g, note: "", created: new Date().toISOString() };
  upsertLocal("settlements", tmp);
  haptic();
  toast(done);
  try {
    const rec = await pb.collection("settlements").create<Settlement>({ from, to, amount: g });
    removeLocal("settlements", tmp.id);
    upsertLocal("settlements", rec);
    return true;
  } catch (e) {
    removeLocal("settlements", tmp.id);
    toast(isNetErr(e) ? "Нет связи — перевод не отмечен" : `Не отметилось: ${errMsg(e)}`);
    return false;
  }
}

export async function deleteSettlement(t: Settlement): Promise<boolean> {
  if (!requireWriter() || t.tmp) return false;
  removeLocal("settlements", t.id);
  haptic();
  try {
    await pb.collection("settlements").delete(t.id);
    toast("Перевод отменён");
    return true;
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return true;
    upsertLocal("settlements", t);
    toast(isNetErr(e) ? "Нет связи — не отменилось" : `Не отменилось: ${errMsg(e)}`);
    return false;
  }
}

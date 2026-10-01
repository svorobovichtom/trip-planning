// Writes. Small patches (toggles, renames) go through the offline queue and
// show up immediately; creates and deletes need the network.

import { confirmAction } from "../ui/Confirm";
import { toast } from "../ui/toast";
import { haptic } from "./haptics";
import { canWriteKey, errMsg, isNetErr, pb } from "./pb";
import { currentPerson, dataStore, openWho, sessionStore } from "./stores";
import { LS } from "./storage";
import { queue, removeLocal, upsertLocal } from "./sync";
import type { Item, Person } from "./types";

/**
 * True when this phone may write: has the key and has picked a person.
 * Otherwise explains (read-only) or opens «Кто ты?».
 */
export function requireWriter(): boolean {
  if (!canWriteKey) {
    toast("Только просмотр — попроси ссылку с ключом");
    return false;
  }
  if (!currentPerson()) {
    openWho(true);
    return false;
  }
  return true;
}

// ---------- people ----------

export function setMe(id: string): void {
  LS.set("trip.me", id);
  sessionStore.set((s) => ({ ...s, me: id }));
  const p = dataStore.get().people.find((x) => x.id === id);
  if (p) toast(`Отмечаешь как ${p.name}`);
}

export const normName = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 40);

/** «Это я»: picks an existing person with the same name, or creates one. */
export async function joinAs(rawName: string): Promise<boolean> {
  const name = normName(rawName);
  if (!name) return false;
  const people = dataStore.get().people;
  const same = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (same) {
    setMe(same.id);
    return true;
  }
  try {
    const sort = Math.max(0, ...people.map((p) => p.sort ?? 0)) + 1;
    const r = await pb.collection("people").create<Person>({ name, sort });
    upsertLocal("people", r);
    setMe(r.id);
    return true;
  } catch (e) {
    toast(isNetErr(e) ? "Нет связи — попробуй, когда появится интернет" : `Не получилось: ${errMsg(e)}`);
    return false;
  }
}

/** Renames a person; works offline (queued). */
export function renamePerson(id: string, rawName: string): void {
  const name = normName(rawName);
  const p = dataStore.get().people.find((x) => x.id === id);
  if (!p || !name || name === p.name) return;
  queue.enqueue("people", id, { name }, { flush: false });
  upsertLocal("people", { ...p, name });
  void queue.flush();
}

// ---------- items ----------

const itemPatch = (done: boolean, me: string) =>
  done ? { done: true, done_by: me, done_at: new Date().toISOString() } : { done: false, done_by: "", done_at: "" };

/** Optimistic toggle. Returns the new done state, or null if not allowed. */
export function toggleItem(id: string): boolean | null {
  const it = dataStore.get().items.get(id);
  if (!it || !requireWriter()) return null;
  const me = sessionStore.get().me!;
  const patch = itemPatch(!it.done, me);
  queue.enqueue("items", id, patch, { flush: false });
  upsertLocal("items", { ...it, ...patch });
  haptic();
  void queue.flush();
  return patch.done;
}

/** Marks several items bought at once (e.g. matched receipt lines). */
export function markItemsDone(ids: string[]): number {
  if (!requireWriter()) return 0;
  const me = sessionStore.get().me!;
  const items = dataStore.get().items;
  let n = 0;
  for (const id of ids) {
    const it = items.get(id);
    if (!it || it.done) continue;
    const patch = itemPatch(true, me);
    queue.enqueue("items", id, patch, { flush: false });
    upsertLocal("items", { ...it, ...patch });
    n++;
  }
  if (n) void queue.flush();
  return n;
}

export function doneCount(): number {
  let n = 0;
  for (const it of dataStore.get().items.values()) if (it.done) n++;
  return n;
}

/** «Снять все отметки». The caller confirms first. */
export function resetAllItems(): number {
  if (!requireWriter()) return 0;
  const done = [...dataStore.get().items.values()].filter((i) => i.done);
  const patch = itemPatch(false, "");
  for (const it of done) {
    queue.enqueue("items", it.id, patch, { flush: false });
    upsertLocal("items", { ...it, ...patch });
  }
  if (done.length) void queue.flush();
  return done.length;
}

export async function addItem(section: string, rawName: string, rawQty: string): Promise<boolean> {
  const name = rawName.trim().slice(0, 120);
  const qty = rawQty.trim().slice(0, 40);
  if (!name || !requireWriter()) return false;
  const inSec = [...dataStore.get().items.values()].filter((i) => i.section === section);
  const sort = Math.max(0, ...inSec.map((i) => i.sort || 0)) + 1;
  try {
    const r = await pb.collection("items").create<Item>({
      key: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      section, name, qty, pl: "", sort, done: false,
    });
    upsertLocal("items", r);
    return true;
  } catch (e) {
    toast(isNetErr(e) ? "Нет связи — добавь, когда появится интернет" : `Не добавилось: ${errMsg(e)}`);
    return false;
  }
}

/** Only items added in the app (key "c-…") can be deleted. */
export const isCustomItem = (it: Pick<Item, "key">) => String(it.key).startsWith("c-");

export async function deleteItem(id: string): Promise<boolean> {
  const it = dataStore.get().items.get(id);
  if (!it || !requireWriter()) return false;
  if (!(await confirmAction({ title: `Удалить «${it.name}»?`, body: "Пункт пропадёт из списка у всех.", ok: "Удалить", danger: true }))) return false;
  try {
    await pb.collection("items").delete(id);
    queue.drop("items", id);
    removeLocal("items", id);
    return true;
  } catch (e) {
    toast(isNetErr(e) ? "Нет связи" : `Не удалилось: ${errMsg(e)}`);
    return false;
  }
}

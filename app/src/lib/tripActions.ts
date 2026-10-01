// Writes for «Поездка» (house, meals, notes). Edits go through the offline
// queue like renames; creates and deletes need the network (like items).
// Only the key is required: a note without a chosen person has no author.

import { confirmAction } from "../ui/Confirm";
import { toast } from "../ui/toast";
import { canWriteKey, errMsg, isNetErr, pb } from "./pb";
import { dataStore, sessionStore } from "./stores";
import { queue, removeLocal, upsertLocal } from "./sync";
import { type House, HOUSE_ID, type Meal, type Note } from "./types";

function requireKey(): boolean {
  if (canWriteKey) return true;
  toast("Только просмотр — попроси ссылку с ключом");
  return false;
}

const clip = (s: string, n: number) => s.trim().slice(0, n);
const netToast = (what: string) => (e: unknown) => {
  toast(isNetErr(e) ? "Нет связи — попробуй, когда появится интернет" : `${what}: ${errMsg(e)}`);
  return false;
};

/** Patches changed fields; works offline. Returns true if anything changed. */
function patchQueued<T extends { id: string }>(coll: "house" | "meals" | "notes", cur: T, next: Partial<T>): boolean {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) if ((cur as Record<string, unknown>)[k] !== v) patch[k] = v;
  if (!Object.keys(patch).length) return false;
  queue.enqueue(coll, cur.id, patch, { flush: false });
  upsertLocal(coll, { ...cur, ...patch });
  void queue.flush();
  return true;
}

// ---------- house ----------

export type HouseFields = Required<Pick<House, "address" | "dates" | "wifi_name" | "wifi_pass" | "info">>;

export function saveHouse(f: HouseFields): boolean {
  if (!requireKey()) return false;
  const cur: House = dataStore.get().house ?? { id: HOUSE_ID };
  const norm = (k: keyof House) => String(cur[k] ?? "");
  const next: HouseFields = {
    address: clip(f.address, 200),
    dates: clip(f.dates, 120),
    wifi_name: clip(f.wifi_name, 64),
    wifi_pass: clip(f.wifi_pass, 64),
    info: clip(f.info, 2000),
  };
  const base = { ...cur, address: norm("address"), dates: norm("dates"), wifi_name: norm("wifi_name"), wifi_pass: norm("wifi_pass"), info: norm("info") };
  return patchQueued("house", base, next);
}

// ---------- meals ----------

export type MealFields = Pick<Meal, "day" | "dish"> & { meal: string };

const normMeal = (f: MealFields): MealFields => ({ day: clip(f.day, 30), meal: clip(f.meal, 30), dish: clip(f.dish, 300) });

export async function addMeal(f: MealFields): Promise<boolean> {
  const m = normMeal(f);
  if (!m.day || !m.dish || !requireKey()) return false;
  // after the day's last meal, or a new day at the end
  const all = [...dataStore.get().meals.values()];
  const inDay = all.filter((x) => x.day.toLowerCase() === m.day.toLowerCase());
  const order = inDay.length ? Math.max(...inDay.map((x) => x.order || 0)) + 1 : Math.max(0, ...all.map((x) => x.order || 0)) + 10;
  try {
    upsertLocal("meals", await pb.collection("meals").create<Meal>({ ...m, order }));
    return true;
  } catch (e) {
    return netToast("Не добавилось")(e);
  }
}

export function updateMeal(id: string, f: MealFields): boolean {
  const cur = dataStore.get().meals.get(id);
  const m = normMeal(f);
  if (!cur || !m.day || !m.dish || !requireKey()) return false;
  return patchQueued("meals", { ...cur, meal: cur.meal ?? "" }, m);
}

export async function deleteMeal(id: string): Promise<boolean> {
  const cur = dataStore.get().meals.get(id);
  if (!cur || !requireKey()) return false;
  const what = [cur.day, cur.meal].filter(Boolean).join(", ");
  if (!(await confirmAction({ title: `Удалить ${what}?`, body: "Пропадёт из меню у всех.", ok: "Удалить", danger: true }))) return false;
  try {
    await pb.collection("meals").delete(id);
    queue.drop("meals", id);
    removeLocal("meals", id);
    return true;
  } catch (e) {
    return netToast("Не удалилось")(e);
  }
}

// ---------- notes ----------

export async function addNote(raw: string): Promise<boolean> {
  const text = clip(raw, 1000);
  if (!text || !requireKey()) return false;
  const me = sessionStore.get().me;
  const author = me && dataStore.get().people.some((p) => p.id === me) ? me : "";
  try {
    upsertLocal("notes", await pb.collection("notes").create<Note>({ text, author }));
    return true;
  } catch (e) {
    return netToast("Не добавилось")(e);
  }
}

export function updateNote(id: string, raw: string): boolean {
  const cur = dataStore.get().notes.get(id);
  const text = clip(raw, 1000);
  if (!cur || !text || !requireKey()) return false;
  return patchQueued("notes", cur, { text });
}

export async function deleteNote(id: string): Promise<boolean> {
  if (!dataStore.get().notes.has(id) || !requireKey()) return false;
  if (!(await confirmAction({ title: "Удалить заметку?", body: "Она пропадёт у всех.", ok: "Удалить", danger: true }))) return false;
  try {
    await pb.collection("notes").delete(id);
    queue.drop("notes", id);
    removeLocal("notes", id);
    return true;
  } catch (e) {
    return netToast("Не удалилось")(e);
  }
}

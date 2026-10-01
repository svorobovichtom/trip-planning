// Pure helpers for «Поездка»: menu days, note times, the maps link.
import type { Meal } from "../../lib/types";

export interface Day {
  day: string;
  meals: Meal[];
}

/** Meals grouped by day (case-insensitive); days in the order of their first meal. */
export function groupDays(meals: Iterable<Meal>): Day[] {
  const sorted = [...meals].sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.created ?? "").localeCompare(String(b.created ?? "")));
  const by = new Map<string, Day>();
  for (const m of sorted) {
    const k = m.day.trim().toLowerCase();
    let d = by.get(k);
    if (!d) by.set(k, (d = { day: m.day.trim(), meals: [] }));
    d.meals.push(m);
  }
  return [...by.values()];
}

/** PocketBase date ("2026-10-01 21:46:39.024Z") -> ms, NaN if empty/bad. */
export const pbTime = (s?: string): number => (s ? Date.parse(s.replace(" ", "T")) : NaN);

const dayStart = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** «только что», «5 мин назад», «3 ч назад», «вчера», «28 сент.» */
export function relTime(iso: string | undefined, now = Date.now()): string {
  const t = pbTime(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  if (dayStart(t) === dayStart(now)) return `${Math.floor(min / 60)} ч назад`;
  if (dayStart(t) === dayStart(now - 86400000)) return "вчера";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(t);
}

/** Apple Maps search; on other devices maps.apple.com opens in the browser. */
export const mapsUrl = (address: string) => `https://maps.apple.com/?q=${encodeURIComponent(address.trim())}`;

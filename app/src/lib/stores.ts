// Small external stores read with useSyncExternalStore.
//
//   dataStore     people/items/expenses/claims/settlements/house/meals/notes as the server has them, with
//                 queued (offline) patches already applied
//   sessionStore  who I am, reachability
//   uiStore       tab, open sheets
//
// State objects are replaced on change (never mutated), so selectors that
// return a slice (s.items, s.people) are stable between unrelated updates.

import { useSyncExternalStore } from "react";
import { LS } from "./storage";
import type { Claim, Expense, House, Item, Meal, Note, Person, Settlement } from "./types";

export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const v = typeof next === "function" ? (next as (p: T) => T)(state) : next;
      if (Object.is(v, state)) return;
      state = v;
      for (const fn of listeners) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** `selector` must return a stable value (a slice or a primitive), not a new object. */
export function useStore<T, U>(store: Store<T>, selector: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}

// ---------- data ----------

export interface DataState {
  /** true once a snapshot or the server answered */
  loaded: boolean;
  /** the first load failed and there is no snapshot */
  loadFailed: boolean;
  /** the server has payments (claims collection etc.) */
  v2: boolean;
  /** sorted by sort, created, id (same order on every phone) */
  people: Person[];
  items: Map<string, Item>;
  expenses: Map<string, Expense>;
  claims: Map<string, Claim>;
  /** the server has the settlements collection («переведено») */
  hasSettlements: boolean;
  settlements: Map<string, Settlement>;
  /** the server has house/meals/notes («Поездка»; readable only with the key) */
  hasTrip: boolean;
  house: House | null;
  meals: Map<string, Meal>;
  notes: Map<string, Note>;
}

export const dataStore = createStore<DataState>({
  loaded: false,
  loadFailed: false,
  v2: true,
  people: [],
  items: new Map(),
  expenses: new Map(),
  claims: new Map(),
  hasSettlements: false,
  settlements: new Map(),
  hasTrip: false,
  house: null,
  meals: new Map(),
  notes: new Map(),
});

export const sortPeople = (people: Person[]): Person[] =>
  [...people].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created ?? "").localeCompare(String(b.created ?? "")) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const useData = <U>(selector: (s: DataState) => U): U => useStore(dataStore, selector);
export const usePeople = () => useData((s) => s.people);
export const useItems = () => useData((s) => s.items);
export const useExpenses = () => useData((s) => s.expenses);
export const useClaims = () => useData((s) => s.claims);
export const useSettlements = () => useData((s) => s.settlements);
export const useLoaded = () => useData((s) => s.loaded);

// ---------- session ----------

export interface SessionState {
  /** person id as stored ("trip.me"); may point at a deleted person */
  me: string | null;
  /** null until the first connect or failure */
  online: boolean | null;
}

export const sessionStore = createStore<SessionState>({ me: LS.get("trip.me"), online: null });

export function setOnline(online: boolean): void {
  sessionStore.set((s) => (s.online === online ? s : { ...s, online }));
}

/** The current person, if they still exist. */
export function useMe(): Person | undefined {
  const me = useStore(sessionStore, (s) => s.me);
  const people = usePeople();
  return me ? people.find((p) => p.id === me) : undefined;
}
export function currentPerson(): Person | undefined {
  const me = sessionStore.get().me;
  return me ? dataStore.get().people.find((p) => p.id === me) : undefined;
}

// ---------- ui ----------

export type Tab = "list" | "exp" | "sum";
export const TABS: Tab[] = ["list", "exp", "sum"];

/** The profile sheet: «main» (me, money, how to pay me, the trip) or the «Кто ты?» step. */
export type ProfileStep = "main" | "who";

export interface UiState {
  tab: Tab;
  profileOpen: boolean;
  profileStep: ProfileStep;
  /** the step it was opened on: «Кто ты?» opened directly closes after choosing */
  profileEntry: ProfileStep;
  /** > 0: open «Как тебе переводить» for editing (Revolut field); bumped per request */
  profilePay: number;
}

const savedTab = LS.get("trip.tab");
export const uiStore = createStore<UiState>({
  tab: savedTab === "exp" || savedTab === "sum" ? savedTab : "list",
  profileOpen: false,
  profileStep: "main",
  profileEntry: "main",
  profilePay: 0,
});

export const useUi = <U>(selector: (s: UiState) => U): U => useStore(uiStore, selector);

export function setTab(tab: Tab): void {
  LS.set("trip.tab", tab === "list" ? null : tab);
  uiStore.set((s) => (s.tab === tab ? s : { ...s, tab }));
}

let paySeq = 0;
export function openProfile(step: ProfileStep = "main", pay = false): void {
  uiStore.set((s) => ({ ...s, profileOpen: true, profileStep: step, profileEntry: step, profilePay: pay ? ++paySeq : 0 }));
}
export const closeProfile = () => uiStore.set((s) => (s.profileOpen ? { ...s, profileOpen: false, profilePay: 0 } : s));
/** Switches steps inside the open profile («Сменить» / «Назад»). */
export const setProfileStep = (step: ProfileStep) => uiStore.set((s) => ({ ...s, profileStep: step, profilePay: 0 }));
/** «Кто ты?»: the profile on its who-am-I step. */
export const openWho = (open = true) => (open ? openProfile("who") : closeProfile());
/** «Как тебе переводить»: the profile with my Revtag field open. */
export const openPay = () => openProfile("main", true);

// Small external stores read with useSyncExternalStore.
//
//   dataStore     people/items/expenses/claims as the server has them, with
//                 queued (offline) patches already applied
//   sessionStore  who I am, reachability
//   uiStore       tab, open sheets
//
// State objects are replaced on change (never mutated), so selectors that
// return a slice (s.items, s.people) are stable between unrelated updates.

import { useSyncExternalStore } from "react";
import { LS } from "./storage";
import type { Claim, Expense, Item, Person } from "./types";

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
  /** sorted by sort, created */
  people: Person[];
  items: Map<string, Item>;
  expenses: Map<string, Expense>;
  claims: Map<string, Claim>;
}

export const dataStore = createStore<DataState>({
  loaded: false,
  loadFailed: false,
  v2: true,
  people: [],
  items: new Map(),
  expenses: new Map(),
  claims: new Map(),
});

export const sortPeople = (people: Person[]): Person[] =>
  [...people].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created ?? "").localeCompare(String(b.created ?? "")));

export const useData = <U>(selector: (s: DataState) => U): U => useStore(dataStore, selector);
export const usePeople = () => useData((s) => s.people);
export const useItems = () => useData((s) => s.items);
export const useExpenses = () => useData((s) => s.expenses);
export const useClaims = () => useData((s) => s.claims);
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

export interface UiState {
  tab: Tab;
  whoOpen: boolean;
  moreOpen: boolean;
}

const savedTab = LS.get("trip.tab");
export const uiStore = createStore<UiState>({
  tab: savedTab === "exp" || savedTab === "sum" ? savedTab : "list",
  whoOpen: false,
  moreOpen: false,
});

export const useUi = <U>(selector: (s: UiState) => U): U => useStore(uiStore, selector);

export function setTab(tab: Tab): void {
  LS.set("trip.tab", tab === "list" ? null : tab);
  uiStore.set((s) => (s.tab === tab ? s : { ...s, tab }));
}
export const openWho = (open = true) => uiStore.set((s) => ({ ...s, whoOpen: open, moreOpen: open ? false : s.moreOpen }));
export const openMore = (open = true) => uiStore.set((s) => ({ ...s, moreOpen: open, whoOpen: open ? false : s.whoOpen }));

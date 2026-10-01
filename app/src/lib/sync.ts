// Loading and live updates: snapshot -> full reload -> realtime, with
// catch-up after reconnects and when the page becomes visible again. Also
// owns the offline write queue.

import type { RecordModel, RecordSubscription } from "pocketbase";
import { toast } from "../ui/toast";
import { errMsg, isNetErr, pb } from "./pb";
import { type PendingOp, WriteQueue } from "./queue";
import { type DataState, dataStore, setOnline, sortPeople } from "./stores";
import { LS, readJSON } from "./storage";
import type { Claim, Expense, Item, Person } from "./types";

export const SNAP_KEY = "trip.next.snap";
const LEGACY_SNAP_KEY = "trip.snap";

// ---------- write queue ----------

export const queue = new WriteQueue({
  kv: LS,
  // The server's copy (newer `updated`) replaces the optimistic one.
  send: async (op: PendingOp) => {
    const rec = await pb.collection(op.coll).update(op.id, op.data);
    if (op.coll === "items" || op.coll === "people") upsertLocal(op.coll, rec);
  },
  isNetErr,
  onFail: (_op, e) => {
    toast(`Не сохранилось: ${errMsg(e)}`);
    void reloadAll();
  },
  onNetwork: setOnline,
});

/** Applies queued patches of a collection to fresh server records. */
function overlayAll<T extends { id: string }>(coll: string, recs: T[]): T[] {
  return queue.size ? recs.map((r) => queue.overlay(coll, r)) : recs;
}

// ---------- snapshot ----------

interface Snapshot {
  people?: Person[];
  items?: Item[];
  expenses?: Expense[];
  claims?: Claim[] | null;
}

function applySnapshot(snap: Snapshot): boolean {
  if (!snap || !Array.isArray(snap.items) || !snap.items.length) return false;
  dataStore.set((s) => ({
    ...s,
    loaded: true,
    people: sortPeople(snap.people ?? []),
    items: new Map(overlayAll("items", snap.items!).map((r) => [r.id, r])),
    expenses: new Map((snap.expenses ?? []).map((r) => [r.id, r])),
    claims: new Map((snap.claims ?? []).map((r) => [r.id, r])),
  }));
  return true;
}

let snapT: ReturnType<typeof setTimeout> | undefined;
function saveSnapSoon(s: DataState) {
  clearTimeout(snapT);
  snapT = setTimeout(() => {
    const snap: Snapshot = {
      people: s.people,
      items: [...s.items.values()],
      expenses: [...s.expenses.values()],
      claims: [...s.claims.values()].filter((c) => !c.tmp),
    };
    try {
      LS.set(SNAP_KEY, JSON.stringify(snap));
    } catch {
      /* quota: ignore */
    }
  }, 500);
}

// ---------- full load ----------

let loading: Promise<boolean> | null = null;
// Records changed locally (realtime event, our own write's response,
// optimistic update) while a reload is in flight win over the reload's
// possibly older copy; removals likewise stay removed.
let during: { touched: Set<string>; removed: Set<string> } | null = null;
const rk = (coll: string, id: string) => `${coll}:${id}`;

function mergeList<T extends { id: string }>(coll: string, fresh: T[], local: Iterable<T>): T[] {
  if (!during) return fresh;
  const { touched, removed } = during;
  const byId = new Map(fresh.filter((r) => !removed.has(rk(coll, r.id))).map((r) => [r.id, r]));
  for (const r of local) if (touched.has(rk(coll, r.id))) byId.set(r.id, r);
  return [...byId.values()];
}

/** Reloads everything. Resolves false on failure (offline etc.). */
export function reloadAll(): Promise<boolean> {
  if (!loading) loading = doReload().finally(() => (loading = null));
  return loading;
}

async function doReload(): Promise<boolean> {
  during = { touched: new Set(), removed: new Set() };
  try {
    const [people, items, expenses, claims] = await Promise.all([
      pb.collection("people").getFullList<Person>({ sort: "sort,created" }),
      pb.collection("items").getFullList<Item>({ sort: "sort,created" }),
      pb.collection("expenses").getFullList<Expense>({ sort: "-created" }),
      // No claims collection = a server from before payments.
      pb
        .collection("claims")
        .getFullList<Claim>({ fields: "id,expense,line,person" })
        .catch((e: unknown) => {
          if ((e as { status?: number })?.status === 404) return null;
          throw e;
        }),
    ]);
    dataStore.set((s) => ({
      ...s,
      loaded: true,
      loadFailed: false,
      v2: claims !== null,
      people: sortPeople(mergeList("people", overlayAll("people", people), s.people)),
      items: new Map(mergeList("items", overlayAll("items", items), s.items.values()).map((r) => [r.id, r])),
      expenses: new Map(mergeList("expenses", expenses, s.expenses.values()).map((r) => [r.id, r])),
      // keep optimistic claims that the server hasn't echoed yet
      claims: new Map([
        ...mergeList(
          "claims",
          (claims ?? []).map((r) => ({ id: r.id, expense: r.expense, line: r.line, person: r.person })),
          s.claims.values(),
        ).map((c) => [c.id, c] as const),
        // optimistic claims the server hasn't echoed yet
        ...[...s.claims.values()].filter((c) => c.tmp).map((c) => [c.id, c] as const),
      ]),
    }));
    setOnline(true);
    return true;
  } catch (e) {
    if (isNetErr(e)) setOnline(false);
    dataStore.set((s) => (s.loaded ? s : { ...s, loadFailed: true }));
    return false;
  } finally {
    during = null;
  }
}

// ---------- local record updates (also used by optimistic writes) ----------

type Coll = "people" | "items" | "expenses" | "claims";

export function upsertLocal(coll: Coll, rec: RecordModel | Person | Item | Expense | Claim): void {
  during?.touched.add(rk(coll, rec.id));
  during?.removed.delete(rk(coll, rec.id));
  dataStore.set((s) => {
    switch (coll) {
      case "people": {
        const r = queue.overlay("people", rec as Person);
        const i = s.people.findIndex((p) => p.id === r.id);
        const next = i >= 0 ? s.people.map((p, j) => (j === i ? r : p)) : [...s.people, r];
        return { ...s, people: sortPeople(next) };
      }
      case "items": {
        const items = new Map(s.items);
        items.set(rec.id, queue.overlay("items", rec as Item));
        return { ...s, items };
      }
      case "expenses": {
        const expenses = new Map(s.expenses);
        expenses.set(rec.id, rec as Expense);
        return { ...s, expenses };
      }
      case "claims": {
        const c = rec as Claim;
        const claims = new Map(s.claims);
        // the server's copy of our own claim replaces its optimistic one
        for (const o of s.claims.values()) {
          if (o.tmp && o.expense === c.expense && o.line === c.line && o.person === c.person) claims.delete(o.id);
        }
        claims.set(c.id, c.tmp ? c : { id: c.id, expense: c.expense, line: c.line, person: c.person });
        return { ...s, claims };
      }
    }
  });
}

export function removeLocal(coll: Coll, id: string): void {
  during?.removed.add(rk(coll, id));
  during?.touched.delete(rk(coll, id));
  dataStore.set((s) => {
    switch (coll) {
      case "people":
        return { ...s, people: s.people.filter((p) => p.id !== id) };
      case "items": {
        if (!s.items.has(id)) return s;
        const items = new Map(s.items);
        items.delete(id);
        return { ...s, items };
      }
      case "expenses": {
        if (!s.expenses.has(id)) return s;
        const expenses = new Map(s.expenses);
        expenses.delete(id);
        return { ...s, expenses };
      }
      case "claims": {
        if (!s.claims.has(id)) return s;
        const claims = new Map(s.claims);
        claims.delete(id);
        return { ...s, claims };
      }
    }
  });
}

// ---------- realtime ----------

const handler = (coll: Coll) => (e: RecordSubscription<RecordModel>) => {
  if (e.action === "delete") removeLocal(coll, e.record.id);
  else upsertLocal(coll, e.record);
};

let everConnected = false;
let connectT: ReturnType<typeof setTimeout> | undefined;

async function connect(): Promise<void> {
  clearTimeout(connectT);
  try {
    await pb.realtime.subscribe("PB_CONNECT", () => {
      setOnline(true);
      // catch up on anything missed while disconnected
      if (everConnected) void reloadAll();
      everConnected = true;
      void queue.flush();
    });
    await pb.collection("items").subscribe("*", handler("items"));
    await pb.collection("people").subscribe("*", handler("people"));
    await pb.collection("expenses").subscribe("*", handler("expenses"));
    if (dataStore.get().v2) await pb.collection("claims").subscribe("*", handler("claims"));
  } catch {
    setOnline(false);
    connectT = setTimeout(() => void connect(), 4000);
  }
}

// ---------- boot ----------

let booted = false;

export async function startSync(): Promise<void> {
  if (booted) return;
  booted = true;

  // Instant start: our own snapshot, else the legacy page's (same shape).
  applySnapshot(readJSON<Snapshot>(LS, SNAP_KEY, {})) || applySnapshot(readJSON<Snapshot>(LS, LEGACY_SNAP_KEY, {}));
  dataStore.subscribe(() => {
    const s = dataStore.get();
    if (s.loaded) saveSnapSoon(s);
  });

  pb.realtime.onDisconnect = () => setOnline(false);
  addEventListener("online", () => {
    void reloadAll();
    void queue.flush();
  });
  addEventListener("offline", () => setOnline(false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void reloadAll().then((ok) => ok && setOnline(pb.realtime.isConnected));
    void queue.flush();
  });

  await reloadAll();
  void connect();
  void queue.flush();
}

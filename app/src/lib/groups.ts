// «Рассчитываемся вместе»: who is in a group with whom (people.wallet, see
// groupHeads in ledger.ts) and the people patches that change it. Pure, so
// the profile writes exactly what regroup() returns.
//
// Stored flat: every member's wallet is the head, the head's is "". A group
// of one is no group (wallet ""). When the head leaves, the first remaining
// member in list order takes over.

import { groupHeads } from "./ledger";
import type { Person } from "./types";

export interface WalletPatch {
  id: string;
  wallet: string;
}

type P = Pick<Person, "id" | "wallet">;

/**
 * Patches that put people into groups by key: people with the same key form
 * a group, headed by the person whose id is the key (or the first in list
 * order). People missing from `key` keep their current group.
 */
function apply(people: readonly P[], key: ReadonlyMap<string, string>): WalletPatch[] {
  const head = groupHeads(people);
  const k = (id: string) => key.get(id) ?? head.get(id)!;
  const groups = new Map<string, string[]>();
  for (const p of people) {
    const g = groups.get(k(p.id));
    if (g) g.push(p.id);
    else groups.set(k(p.id), [p.id]);
  }
  const out: WalletPatch[] = [];
  for (const [g, ids] of groups) {
    const h = ids.includes(g) ? g : ids[0]!;
    for (const id of ids) {
      const wallet = ids.length > 1 && id !== h ? h : "";
      const p = people.find((x) => x.id === id)!;
      if ((p.wallet || "") !== wallet) out.push({ id, wallet });
    }
  }
  return out;
}

/** The people in `me`'s group, list order (just `me` when alone). */
export function groupOf(people: readonly P[], me: string): string[] {
  const head = groupHeads(people);
  const h = head.get(me);
  return h ? people.filter((p) => head.get(p.id) === h).map((p) => p.id) : [];
}

/** The head of `me`'s group (`me` when alone). */
export const headOf = (people: readonly P[], me: string): string => groupHeads(people).get(me) ?? me;

/**
 * `id` joins (on) or leaves (off) `me`'s group. Joining takes only that
 * person out of their old group; a group that loses its head gets a new one.
 */
export function toggleMember(people: readonly P[], me: string, id: string, on: boolean): WalletPatch[] {
  const head = groupHeads(people);
  const h = head.get(me);
  if (!h || !head.has(id) || id === me) return [];
  const key = new Map<string, string>();
  // whoever is left behind regroups around a fresh key (-> first in list order)
  const rest = (g: string, without: string) => {
    for (const p of people) if (p.id !== without && head.get(p.id) === g) key.set(p.id, `~${g}`);
  };
  if (on) {
    if (head.get(id) === h) return [];
    if (head.get(id) === id) rest(id, id);
    key.set(id, h);
  } else {
    if (head.get(id) !== h) return [];
    if (id === h) rest(h, id);
    // a key of their own, so two who left don't form a group
    key.set(id, `~solo:${id}`);
  }
  return apply(people, key);
}

/** `me` leaves their group (the others stay together). */
export function leaveGroup(people: readonly P[], me: string): WalletPatch[] {
  const head = groupHeads(people);
  const h = head.get(me);
  if (!h) return [];
  const key = new Map<string, string>([[me, `~solo:${me}`]]);
  if (h === me) for (const p of people) if (p.id !== me && head.get(p.id) === h) key.set(p.id, `~${h}`);
  return apply(people, key);
}

/** `id` becomes the one who transfers for their group. */
export function makeHead(people: readonly P[], id: string): WalletPatch[] {
  const head = groupHeads(people);
  const h = head.get(id);
  if (!h || h === id) return [];
  const key = new Map<string, string>();
  for (const p of people) if (head.get(p.id) === h) key.set(p.id, id);
  return apply(people, key);
}

/** «Юля», «Том и Юля», «Том, Юля и Лика»: the head first, then list order. */
export function groupLabel(head: string, members: readonly string[], name: (id: string) => string): string {
  const ns = [head, ...members.filter((id) => id !== head)].map(name);
  return ns.length > 1 ? `${ns.slice(0, -1).join(", ")} и ${ns[ns.length - 1]}` : (ns[0] ?? "");
}

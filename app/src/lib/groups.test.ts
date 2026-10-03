import { describe, expect, it } from "vitest";
import { groupLabel, groupOf, leaveGroup, makeHead, toggleMember, type WalletPatch } from "./groups";
import { groupHeads } from "./ledger";
import type { Person } from "./types";

type P = Pick<Person, "id" | "wallet">;
const people = (wallets: Record<string, string> = {}): P[] => ["a", "b", "c", "d"].map((id) => ({ id, wallet: wallets[id] ?? "" }));
const run = (ps: P[], patches: WalletPatch[]): P[] => ps.map((p) => ({ ...p, ...patches.find((x) => x.id === p.id) }));
const heads = (ps: P[]) => Object.fromEntries(groupHeads(ps));

describe("toggleMember", () => {
  it("adds a person to my group; I stay the head", () => {
    const ps = people();
    const patches = toggleMember(ps, "a", "b", true);
    expect(patches).toEqual([{ id: "b", wallet: "a" }]);
    expect(heads(run(ps, patches))).toEqual({ a: "a", b: "a", c: "c", d: "d" });
  });
  it("joins the group I'm in, under its head", () => {
    const ps = people({ a: "b" });
    expect(toggleMember(ps, "a", "c", true)).toEqual([{ id: "c", wallet: "b" }]);
  });
  it("taking the head of another group leaves the rest of it together, under a new head", () => {
    const ps = people({ c: "b", d: "b" });
    const after = run(ps, toggleMember(ps, "a", "b", true));
    expect(heads(after)).toEqual({ a: "a", b: "a", c: "c", d: "c" });
  });
  it("a group of one is no group", () => {
    const ps = people({ c: "b" });
    const after = run(ps, toggleMember(ps, "a", "c", true));
    expect(after.map((p) => p.wallet)).toEqual(["", "", "a", ""]);
  });
  it("removing someone; removing the head hands over to the first in list order", () => {
    const ps = people({ b: "a", c: "a" });
    expect(heads(run(ps, toggleMember(ps, "a", "b", false)))).toEqual({ a: "a", b: "b", c: "a", d: "d" });
    const after = run(ps, toggleMember(ps, "c", "a", false));
    expect(heads(after)).toEqual({ a: "a", b: "b", c: "b", d: "d" });
    expect(after.map((p) => p.wallet)).toEqual(["", "", "b", ""]);
  });
  it("nothing to do: myself, already in, not in", () => {
    const ps = people({ b: "a" });
    expect(toggleMember(ps, "a", "a", true)).toEqual([]);
    expect(toggleMember(ps, "a", "b", true)).toEqual([]);
    expect(toggleMember(ps, "a", "c", false)).toEqual([]);
  });
});

describe("leaveGroup / makeHead / groupOf", () => {
  it("leaving keeps the others together", () => {
    const ps = people({ b: "a", c: "a" });
    expect(heads(run(ps, leaveGroup(ps, "a")))).toEqual({ a: "a", b: "b", c: "b", d: "d" });
    expect(heads(run(ps, leaveGroup(ps, "c")))).toEqual({ a: "a", b: "a", c: "c", d: "d" });
  });
  it("leaving a pair dissolves it", () => {
    const ps = people({ b: "a" });
    expect(run(ps, leaveGroup(ps, "b")).every((p) => !p.wallet)).toBe(true);
  });
  it("makeHead moves everyone over, stored flat", () => {
    const ps = people({ b: "a", c: "a" });
    const after = run(ps, makeHead(ps, "c"));
    expect(after.map((p) => p.wallet)).toEqual(["c", "c", "", ""]);
    expect(makeHead(after, "c")).toEqual([]);
  });
  it("groupOf: list order, just me when alone", () => {
    expect(groupOf(people({ c: "a" }), "c")).toEqual(["a", "c"]);
    expect(groupOf(people(), "d")).toEqual(["d"]);
  });
});

describe("groupLabel", () => {
  const name = (id: string) => ({ a: "Аня", b: "Боря", c: "Вика" })[id] ?? id;
  it("head first", () => {
    expect(groupLabel("a", ["a"], name)).toBe("Аня");
    expect(groupLabel("b", ["a", "b"], name)).toBe("Боря и Аня");
    expect(groupLabel("a", ["a", "b", "c"], name)).toBe("Аня, Боря и Вика");
  });
});

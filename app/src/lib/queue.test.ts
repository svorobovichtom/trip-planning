import { afterEach, describe, expect, it, vi } from "vitest";
import { type PendingOp, QUEUE_KEY, WriteQueue } from "./queue";
import { memoryKV } from "./storage";

const NET = Object.assign(new Error("offline"), { status: 0 });
const DENIED = Object.assign(new Error("forbidden"), { status: 403 });
const isNetErr = (e: unknown) => (e as { status?: number }).status === 0;

function setup(send: (op: PendingOp) => Promise<unknown>, init?: Record<string, string>) {
  const kv = memoryKV(init);
  const onFail = vi.fn();
  const onNetwork = vi.fn();
  const q = new WriteQueue({ kv, send, isNetErr, onFail, onNetwork, retryMs: 1000 });
  return { kv, q, onFail, onNetwork };
}

afterEach(() => vi.useRealTimers());

describe("WriteQueue", () => {
  it("merges patches per record and persists in the legacy format", () => {
    const { q, kv } = setup(() => new Promise(() => {}));
    q.enqueue("items", "i1", { done: true, done_by: "p" }, { flush: false });
    q.enqueue("items", "i1", { done: false }, { flush: false });
    q.enqueue("people", "p1", { name: "Аня" }, { flush: false });
    expect(q.size).toBe(2);
    expect(JSON.parse(kv.get(QUEUE_KEY)!)).toEqual({
      "items:i1": { coll: "items", id: "i1", data: { done: false, done_by: "p" } },
      "people:p1": { coll: "people", id: "p1", data: { name: "Аня" } },
    });
    expect(q.overlay("items", { id: "i1", done: true, name: "x" })).toEqual({ id: "i1", done: false, done_by: "p", name: "x" });
  });

  it("loads a queue left by an earlier session (or the legacy page)", () => {
    const { q } = setup(() => Promise.resolve(), {
      [QUEUE_KEY]: JSON.stringify({ "items:i9": { coll: "items", id: "i9", data: { done: true } }, junk: 1 }),
    });
    expect(q.list()).toEqual([{ coll: "items", id: "i9", data: { done: true } }]);
  });

  it("survives a corrupt stored queue", () => {
    const { q } = setup(() => Promise.resolve(), { [QUEUE_KEY]: "{nope" });
    expect(q.size).toBe(0);
  });

  it("flushes in order and clears storage", async () => {
    const sent: string[] = [];
    const { q, kv, onNetwork } = setup(async (op) => void sent.push(op.id));
    q.enqueue("items", "a", { done: true }, { flush: false });
    q.enqueue("items", "b", { done: true }, { flush: false });
    await q.flush();
    expect(sent).toEqual(["a", "b"]);
    expect(q.size).toBe(0);
    expect(kv.get(QUEUE_KEY)).toBeNull();
    expect(onNetwork).toHaveBeenLastCalledWith(true);
  });

  it("keeps ops on a network error and retries later", async () => {
    vi.useFakeTimers();
    let up = false;
    const send = vi.fn(async () => {
      if (!up) throw NET;
    });
    const { q, onNetwork, kv } = setup(send);
    q.enqueue("items", "a", { done: true }, { flush: false });
    q.enqueue("items", "b", { done: true }, { flush: false });
    await q.flush();
    expect(send).toHaveBeenCalledTimes(1); // stops at the first network error
    expect(q.size).toBe(2);
    expect(onNetwork).toHaveBeenLastCalledWith(false);
    expect(JSON.parse(kv.get(QUEUE_KEY)!)).toHaveProperty("items:a");
    up = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(q.size).toBe(0);
    expect(onNetwork).toHaveBeenLastCalledWith(true);
  });

  it("drops an op the server rejects and reports it", async () => {
    const { q, onFail } = setup(async (op) => {
      if (op.id === "bad") throw DENIED;
    });
    q.enqueue("items", "bad", { done: true }, { flush: false });
    q.enqueue("items", "ok", { done: true }, { flush: false });
    await q.flush();
    expect(q.size).toBe(0);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0]![0]).toMatchObject({ id: "bad" });
  });

  it("re-sends an op that changed while its request was in flight", async () => {
    const sent: unknown[] = [];
    let release!: () => void;
    const { q } = setup((op) => {
      sent.push(op.data);
      if (sent.length === 1) return new Promise<void>((r) => (release = r));
      return Promise.resolve();
    });
    q.enqueue("items", "a", { done: true }, { flush: false });
    const p = q.flush();
    q.enqueue("items", "a", { done: false }); // flush() while flushing is a no-op
    release();
    await p;
    expect(sent).toEqual([{ done: true }, { done: false }]);
    expect(q.size).toBe(0);
  });

  it("notifies subscribers and supports drop()", () => {
    const { q } = setup(() => new Promise(() => {}));
    const fn = vi.fn();
    q.subscribe(fn);
    q.enqueue("items", "a", { done: true }, { flush: false });
    q.drop("items", "a");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(q.size).toBe(0);
  });
});

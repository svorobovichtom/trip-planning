// Offline write queue for small PATCHes (item toggles, renames). Survives
// offline and reloads; persisted under "trip.pending" in the same format as
// the legacy page ({"items:<id>": {coll, id, data}}), so a queue left by
// either app is flushed by the other.
//
// - One entry per record: a later patch merges into the queued one.
// - flush() sends in order. A network error stops the round and retries
//   after `retryMs`; any other error drops that op and reports it (the
//   caller reloads to drop the optimistic value).
// - An op replaced while its request was in flight stays queued and is sent
//   again with the newer data.

import type { KV } from "./storage";

export const QUEUE_KEY = "trip.pending";

export interface PendingOp {
  coll: string;
  id: string;
  data: Record<string, unknown>;
}

export interface QueueDeps {
  kv: KV;
  send: (op: PendingOp) => Promise<unknown>;
  isNetErr: (e: unknown) => boolean;
  /** a non-network failure; the op has been dropped */
  onFail?: (op: PendingOp, e: unknown) => void;
  /** reachability as seen by the last flush round */
  onNetwork?: (online: boolean) => void;
  retryMs?: number;
  storageKey?: string;
}

const opKey = (coll: string, id: string) => `${coll}:${id}`;

export class WriteQueue {
  private ops = new Map<string, PendingOp>();
  private listeners = new Set<() => void>();
  private retryT: ReturnType<typeof setTimeout> | undefined;
  private _flushing = false;
  private readonly key: string;

  constructor(private deps: QueueDeps) {
    this.key = deps.storageKey ?? QUEUE_KEY;
    try {
      const raw = JSON.parse(deps.kv.get(this.key) || "{}") as Record<string, PendingOp>;
      for (const [k, op] of Object.entries(raw)) {
        if (op && typeof op.coll === "string" && typeof op.id === "string" && op.data && typeof op.data === "object") {
          this.ops.set(k, { coll: op.coll, id: op.id, data: { ...op.data } });
        }
      }
    } catch {
      /* corrupt queue: start empty */
    }
  }

  get size(): number {
    return this.ops.size;
  }
  get flushing(): boolean {
    return this._flushing;
  }
  list(): PendingOp[] {
    return [...this.ops.values()];
  }
  /** queued patch for a record, if any */
  patchFor(coll: string, id: string): Record<string, unknown> | undefined {
    return this.ops.get(opKey(coll, id))?.data;
  }
  /** record with queued values applied (new object when there is a patch) */
  overlay<T extends { id: string }>(coll: string, rec: T): T {
    const p = this.patchFor(coll, rec.id);
    return p ? { ...rec, ...p } : rec;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
  private save() {
    this.deps.kv.set(this.key, this.ops.size ? JSON.stringify(Object.fromEntries(this.ops)) : null);
  }

  enqueue(coll: string, id: string, data: Record<string, unknown>, opts: { flush?: boolean } = {}): void {
    const k = opKey(coll, id);
    const prev = this.ops.get(k);
    this.ops.set(k, { coll, id, data: { ...prev?.data, ...data } });
    this.save();
    this.emit();
    if (opts.flush !== false) void this.flush();
  }

  enqueueMany(ops: PendingOp[]): void {
    for (const op of ops) this.enqueue(op.coll, op.id, op.data, { flush: false });
    void this.flush();
  }

  /** Drops queued ops (e.g. for a record that no longer exists). */
  drop(coll: string, id: string): void {
    if (this.ops.delete(opKey(coll, id))) {
      this.save();
      this.emit();
    }
  }

  async flush(): Promise<void> {
    if (this._flushing || !this.ops.size) return;
    this._flushing = true;
    clearTimeout(this.retryT);
    this.emit();
    let netFail = false;
    for (const [k, op] of [...this.ops]) {
      try {
        await this.deps.send(op);
        if (this.ops.get(k) === op) this.ops.delete(k);
      } catch (e) {
        if (this.deps.isNetErr(e)) {
          netFail = true;
          break;
        }
        if (this.ops.get(k) === op) this.ops.delete(k);
        this.deps.onFail?.(op, e);
      }
    }
    this.save();
    this._flushing = false;
    if (netFail) {
      this.deps.onNetwork?.(false);
      this.retryT = setTimeout(() => void this.flush(), this.deps.retryMs ?? 4000);
      this.emit();
      return;
    }
    this.deps.onNetwork?.(true);
    this.emit();
    if (this.ops.size) await this.flush();
  }

  dispose(): void {
    clearTimeout(this.retryT);
    this.listeners.clear();
  }
}

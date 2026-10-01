import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import { reducedMotion } from "../../lib/haptics";
import type { Item } from "../../lib/types";

const HOLD_MS = 600; // a tapped row shows its check before it moves
const FOLD_MS = 320; // then folds away at the old place…
const LAND_MS = 420; // …and fades in at the new one

interface Entry {
  /** group the row is shown in: true = «Куплено» */
  shown: boolean;
  phase: "hold" | "fold";
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Open items stay on top; bought ones gather in «Куплено». A row never
 * jumps: after a tap it holds ~600 ms, then folds away and lands in the
 * other group. Changes from other phones fold/land the same way (no hold).
 * `isVisible(id)` lets rows inside a collapsed group move instantly.
 */
export function useGroupMoves(items: Map<string, Item>, isVisible: (id: string) => boolean) {
  const entries = useRef(new Map<string, Entry>());
  const rendered = useRef(new Map<string, boolean>());
  const landed = useRef(new Set<string>());
  const latest = useRef(items);
  latest.current = items;
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const land = useCallback((id: string) => {
    entries.current.delete(id);
    rendered.current.set(id, !!latest.current.get(id)?.done);
    if (reducedMotion()) return;
    landed.current.add(id);
    setTimeout(() => {
      landed.current.delete(id);
      bump();
    }, LAND_MS);
  }, []);

  const fold = useCallback(
    (id: string, shown: boolean) => {
      clearTimeout(entries.current.get(id)?.timer);
      if (reducedMotion() || !isVisible(id)) {
        land(id);
        return;
      }
      entries.current.set(id, {
        shown,
        phase: "fold",
        timer: setTimeout(() => {
          land(id);
          bump();
        }, FOLD_MS),
      });
    },
    [isVisible, land],
  );

  /** Call right before toggling item `id` whose current done state is `wasDone`. */
  const hold = useCallback(
    (id: string, wasDone: boolean) => {
      const e = entries.current.get(id);
      if (e) clearTimeout(e.timer);
      const shown = e ? e.shown : wasDone;
      entries.current.set(id, {
        shown,
        phase: "hold",
        timer: setTimeout(() => {
          const cur = latest.current.get(id);
          if (cur && !!cur.done !== shown) fold(id, shown);
          else entries.current.delete(id);
          bump();
        }, HOLD_MS),
      });
      bump();
    },
    [fold],
  );

  const groupOf = (it: Item) => entries.current.get(it.id)?.shown ?? !!it.done;

  // Before paint: a row whose group changed elsewhere folds from its old place.
  useLayoutEffect(() => {
    let changed = false;
    const seen = new Map<string, boolean>();
    for (const it of items.values()) {
      const was = rendered.current.get(it.id);
      if (!entries.current.has(it.id) && was !== undefined && was !== !!it.done) {
        fold(it.id, was);
        changed = true;
      }
      seen.set(it.id, entries.current.get(it.id)?.shown ?? !!it.done);
    }
    rendered.current = seen;
    if (changed) bump();
  });

  return {
    groupOf,
    phaseOf: (id: string) => entries.current.get(id)?.phase,
    isLanding: (id: string) => landed.current.has(id),
    hold,
  };
}

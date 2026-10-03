// Receipt lines: read-only (grouped by category, with the list item each
// maps to) and «По чеку» claiming (tap a line you had; several people who
// had the same line split it).
import { useMemo, useState } from "react";
import { requireWriter } from "../../lib/actions";
import { useLuck } from "../../lib/hooks";
import { canWriteKey } from "../../lib/pb";
import { expenseShares, indexClaims, participants } from "../../lib/ledger";
import { fmtG, fmtMinus } from "../../lib/money";
import { sessionStore, useClaims, useItems, usePeople, useStore } from "../../lib/stores";
import type { Expense } from "../../lib/types";
import { Morph } from "../../ui/Morph";
import { toggleClaim } from "./api";
import { CheckBox, useNames } from "./bits";
import { claimProgress, groupLines, type LineGroup, type LineRow, waitingText } from "./logic";

/** Claims of one expense: line index -> claimer ids (list order). Stable between unrelated updates. */
export function useExpenseClaims(x: Expense) {
  const claims = useClaims();
  const people = usePeople();
  const order = useMemo(() => people.map((p) => p.id), [people]);
  const byLine = useMemo(
    () => indexClaims([...claims.values()].filter((c) => c.expense === x.id), order).get(x.id) ?? new Map<number, string[]>(),
    [claims, x.id, order],
  );
  // the leftover grosze exactly as the ledger gives them out
  const luck = useLuck(x.id);
  const shares = useMemo(() => expenseShares(x, order, byLine, new Map(luck)), [x, order, byLine, luck]);
  return { order, byLine, shares };
}

function useItemName() {
  const items = useItems();
  return (id: string | null) => (id ? items.get(id)?.name : undefined);
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function rowPrice(r: LineRow) {
  return r.g === null ? "" : fmtMinus(r.g);
}

function GroupHead({ g, show }: { g: LineGroup; show: boolean }) {
  if (!show) return null;
  return (
    <div className="lg-h">
      <span>{g.cat}</span>
      <span className="num">{fmtMinus(g.g)}</span>
    </div>
  );
}

/** Read-only receipt lines. */
export function LinesList({ x }: { x: Expense }) {
  const { groups, categorized } = useMemo(() => groupLines(x.lines), [x.lines]);
  const itemName = useItemName();
  if (!groups.length) return null;
  const sum = groups.reduce((s, g) => s + g.g, 0);
  return (
    <div className="lines">
      {groups.map((g) => (
        <section key={g.cat || "-"}>
          <GroupHead g={g} show={categorized} />
          <ul className="list cls">
            {g.rows.map((r) => {
              const item = itemName(r.itemId);
              const meta = [r.qty, r.discount ? `скидка ${fmtMinus(r.discount)}` : "", item ? `в списке: ${lower(item)}` : ""].filter(Boolean).join(" · ");
              return (
                <li key={r.idx} className="lrow">
                  <span className="txt">
                    <span className="name">{r.text}</span>
                    {meta && <span className="pl">{meta}</span>}
                  </span>
                  <span className="qty num">{rowPrice(r)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="lg-t">
        <span>Итого по позициям</span>
        <span className="num">{fmtMinus(sum)}</span>
      </div>
    </div>
  );
}

/**
 * «По чеку»: progress, «за другого», tappable lines. `target`/`setTarget`
 * (whose lines a tap marks) may come from the parent; null = me.
 */
export function ClaimsPanel({ x, compact, target: tProp, setTarget: sProp }: {
  x: Expense;
  compact?: boolean;
  target?: string | null;
  setTarget?: (id: string | null) => void;
}) {
  const me = useStore(sessionStore, (s) => s.me);
  const people = usePeople();
  const name = useNames();
  const itemName = useItemName();
  const { order, byLine, shares } = useExpenseClaims(x);
  const { groups, rows, categorized } = useMemo(() => groupLines(x.lines), [x.lines]);
  const [tState, sState] = useState<string | null>(null);
  const target = (tProp !== undefined ? tProp : tState) ?? me;
  const setTarget = sProp ?? sState;
  const [picking, setPicking] = useState(false);
  const pr = claimProgress(x, rows, byLine, participants(x, order));
  const pct = pr.all > 0 ? Math.max(0, Math.min(100, (pr.got / pr.all) * 100)) : 0;
  const other = target && target !== me;

  return (
    <div className={`claims${compact ? " compact" : ""}`}>
      <div className="cl-h">
        <b>
          <Morph>{`Разобрано ${fmtG(pr.got)} из ${fmtG(pr.all)}`}</Morph>
        </b>
        <span>{waitingText(pr.waiting.map((id) => name(id)))}</span>
      </div>
      <div className="cl-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
      {canWriteKey && (
        <div className="cl-for">
          <span className="cl-who">
            {other ? (
              <>
                Отмечаешь за <b>{name(target)}</b> · {fmtG(shares.get(target!) ?? 0)}
              </>
            ) : (
              "Отметь, что брал — строка делится между отметившимися"
            )}
          </span>
          <button
            className="link"
            type="button"
            onClick={() => {
              if (other) {
                setTarget(null);
                setPicking(false);
              } else setPicking((v) => !v);
            }}
          >
            {other ? "за себя" : "за другого"}
          </button>
        </div>
      )}
      {picking && !other && (
        <div className="pills cl-pick">
          {people
            .filter((p) => p.id !== me)
            .map((p) => (
              <button
                key={p.id}
                className="pill"
                type="button"
                onClick={() => {
                  setTarget(p.id);
                  setPicking(false);
                }}
              >
                {p.name}
              </button>
            ))}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.cat || "-"}>
          <GroupHead g={g} show={categorized} />
          <ul className="list cls">
            {g.rows.map((r) => {
              const ids = byLine.get(r.idx) ?? [];
              const on = !!target && ids.includes(target);
              const item = itemName(r.itemId);
              const who = ids.length
                ? ids.map((id) => name(id)).join(", ") + (ids.length > 1 && r.g ? ` · по ${fmtG(Math.round(r.g / ids.length))}` : "")
                : "никто не отметил";
              const meta = [r.qty, r.discount ? `скидка ${fmtMinus(r.discount)}` : "", who, item ? `в списке: ${lower(item)}` : ""].filter(Boolean).join(" · ");
              return (
                <li key={r.idx}>
                  <button
                    className={`cline${ids.length ? " has" : ""}`}
                    type="button"
                    aria-pressed={on}
                    onClick={() => (target ? void toggleClaim(x.id, [r.idx, ...r.extra], target) : requireWriter())}
                  >
                    <CheckBox />
                    <span className="txt">
                      <span className="name">{r.text}</span>
                      <span className="pl">{meta}</span>
                    </span>
                    <span className="qty num">{rowPrice(r)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

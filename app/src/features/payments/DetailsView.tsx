// Payment details: the receipt, how it is split, receipt lines (claimable
// for «По чеку»), «Твоя часть» and list items to mark bought.
import { useMemo, useState } from "react";
import { markItemsDone } from "../../lib/actions";
import { linesOk, participants } from "../../lib/ledger";
import { fmtG, grosze } from "../../lib/money";
import { canWriteKey } from "../../lib/pb";
import { plural } from "../../lib/plural";
import { sessionStore, useItems, useStore } from "../../lib/stores";
import type { Expense } from "../../lib/types";
import { SheetBody, SheetFoot } from "../../ui/FullSheet";
import { Morph } from "../../ui/Morph";
import { toast } from "../../ui/toast";
import { patchExpense, rescan } from "./api";
import { expenseName, fmtDay, Thumb, useNames, viewReceipt } from "./bits";
import { ClaimsPanel, LinesList, useExpenseClaims } from "./Lines";
import { isScanning, parseDate, scanView, unboughtMatches } from "./logic";
import { setPayView } from "./state";

export function DetailsView({ x }: { x: Expense }) {
  const me = useStore(sessionStore, (s) => s.me);
  const name = useNames();
  const items = useItems();
  const { order, shares } = useExpenseClaims(x);
  const [target, setTarget] = useState<string | null>(null);
  const g = grosze(x.amount);
  const when = parseDate(x.spent_at || x.created);
  const claimsOn = x.split_mode === "claims" && linesOk(x);
  const matches = useMemo(() => unboughtMatches(x, (id) => {
    const it = items.get(id);
    return !!it && !it.done;
  }), [x, items]);
  const who = target ?? me;
  const part = who ? (shares.get(who) ?? 0) : 0;

  return (
    <>
      <SheetBody>
        <div className="dt-top">
          <Thumb x={x} scanning={isScanning(x)} onOpen={() => viewReceipt(x, name(x.paid_by))} className="lg" />
          <div className="dt-t">
            <div className="dt-name">{expenseName(x)}</div>
            <div className="dt-amt num">
              <Morph>{g ? fmtG(g) : isScanning(x) ? "…" : "—"}</Morph>
            </div>
            <div className="dt-meta">
              {[`платил ${name(x.paid_by)}`, when ? fmtDay.format(when) : "", x.title ? x.category : ""].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
        <ScanLine x={x} />

        {claimsOn ? (
          <ClaimsPanel x={x} target={target} setTarget={setTarget} />
        ) : (
          <>
            <SplitSummary x={x} order={order} shares={shares} name={name} />
            {linesOk(x) && canWriteKey && (
              <div className="dt-act">
                <button className="btn" type="button" onClick={() => void patchExpense(x, { split_mode: "claims" })}>
                  Делить по чеку
                </button>
                <span className="hint">каждый отметит, что брал</span>
              </div>
            )}
            <LinesList x={x} />
          </>
        )}

        {canWriteKey && matches.length > 0 && (
          <div className="match">
            <p>
              Есть в списке, ещё не отмечено: <b>{matches.map((id) => items.get(id)?.name.toLowerCase()).join(", ")}</b>
            </p>
            <button
              className="btn"
              type="button"
              onClick={() => {
                const n = markItemsDone(matches);
                if (n) toast(`Отмечено купленными: ${n}`);
              }}
            >
              Отметить {matches.length} {plural(matches.length, "пункт", "пункта", "пунктов")} списка купленными
            </button>
          </div>
        )}
      </SheetBody>
      {(who || canWriteKey) && (
        <SheetFoot>
          <span className="part">
            {who && (
              <>
                <span className="part-k">{target && target !== me ? `Часть: ${name(target)}` : "Твоя часть"}</span>
                <b className="num">
                  <Morph>{fmtG(part)}</Morph>
                </b>
              </>
            )}
          </span>
          <span className="fs-sp" />
          {canWriteKey && (
            <button className="btn" type="button" onClick={() => setPayView("edit")}>
              Изменить
            </button>
          )}
        </SheetFoot>
      )}
    </>
  );
}

function ScanLine({ x }: { x: Expense }) {
  const sv = scanView(x);
  if (sv.kind === "scanning") return <p className="dt-st shim">Читаю чек… обычно минута-две</p>;
  if (sv.kind === "failed")
    return (
      <p className="dt-st">
        Не распознали{sv.retry ? " · " : " — этот формат не читаю"}
        {sv.retry && canWriteKey && (
          <button className="rt" type="button" onClick={() => void rescan(x)}>
            повторить
          </button>
        )}
      </p>
    );
  if (sv.kind === "mismatch") return <p className="dt-st">Позиции неточные — не сходятся с суммой чека, поэтому «По чеку» недоступно</p>;
  if (sv.kind === "unread" && canWriteKey)
    return (
      <p className="dt-st">
        Чек ещё не распознан ·{" "}
        <button className="rt" type="button" onClick={() => void rescan(x)}>
          Распознать чек
        </button>
      </p>
    );
  return null;
}

function SplitSummary({ x, order, shares, name }: {
  x: Expense;
  order: readonly string[];
  shares: Map<string, number>;
  name: (id: string) => string;
}) {
  const ids = participants(x, order);
  const g = grosze(x.amount);
  if (x.split_mode === "amounts" && x.split_amounts && Object.keys(x.split_amounts).length) {
    const auto = new Set(Object.entries(x.split_amounts).filter(([, v]) => v == null).map(([k]) => k));
    return (
      <>
        <div className="fl">Суммами</div>
        <ul className="list kv">
          {order
            .filter((id) => shares.has(id))
            .map((id) => (
              <li key={id}>
                <span>
                  {name(id)}
                  {auto.has(id) && <span className="kv-n"> · авто</span>}
                </span>
                <span className="num">{fmtG(shares.get(id) ?? 0)}</span>
              </li>
            ))}
        </ul>
      </>
    );
  }
  const n = ids.length;
  const each = g && n ? `по ${fmtG(Math.floor(g / n))}` : "сумма ещё неизвестна";
  return (
    <p className="dt-split">
      <Morph>{`${n === order.length ? `Поровну на всех ${n}` : `Поровну на ${n}`} · ${each}`}</Morph>
      {n < order.length && <span className="dt-split-n">{ids.map((id) => name(id)).join(", ")}</span>}
    </p>
  );
}

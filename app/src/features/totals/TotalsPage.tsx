// «Итоги для тебя»: the selected person's balance and transfers first, then
// the trip (total, per person, categories), then the transfers already made,
// what's left for everyone, the balance table and CSV behind spoilers. All
// numbers come from lib/ledger.ts (transfers marked «Перевёл»/«Получил»
// included) and morph in place when something arrives over realtime.
import { Collapsible } from "@base-ui/react/collapsible";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { haptic } from "../../lib/haptics";
import { useLedger } from "../../lib/hooks";
import { type Ledger, settle, sortedCats, type Transfer } from "../../lib/ledger";
import { fmtG } from "../../lib/money";
import { canWriteKey } from "../../lib/pb";
import { plural } from "../../lib/plural";
import { openWho, setTab, useData, useExpenses, useLoaded, useMe, usePeople, useSettlements } from "../../lib/stores";
import type { Person, Settlement } from "../../lib/types";
import { confirmAction, showCopy } from "../../ui/Confirm";
import { ChevronIcon } from "../../ui/icons";
import { Morph } from "../../ui/Morph";
import { toast } from "../../ui/toast";
import { deleteSettlement } from "./api";
import { exportCsv } from "./csv";
import { copyDec, fmtDec, fmtDecSigned, fmtWhen } from "./format";
import { type SettleAsk, SettleSheet } from "./SettleSheet";
import "./totals.css";

type NameOf = (id: string) => string;
type Ask = (a: Omit<SettleAsk, "seq">) => void;

export function TotalsPage() {
  const loaded = useLoaded();
  const n = useExpenses().size;
  if (!loaded) return null;
  return n ? <Totals n={n} /> : <Empty />;
}

function Empty() {
  return (
    <section className="t-card t-empty">
      <div className="t-k">Всего потрачено</div>
      <div className="t-big num">{fmtG(0)}</div>
      <p>Чеков пока нет. Добавь первый во вкладке «Расходы» — и здесь появится, кто кому сколько переводит.</p>
      <button className="btn" type="button" onClick={() => setTab("exp")}>
        Добавить чек
      </button>
    </section>
  );
}

function Totals({ n }: { n: number }) {
  const L = useLedger();
  const people = usePeople();
  const me = useMe();
  const tx = useMemo(() => settle(L.bal), [L]);
  const name = useMemo<NameOf>(() => {
    const m = new Map(people.map((p) => [p.id, p.name]));
    return (id) => m.get(id) ?? "?";
  }, [people]);
  // «Перевёл»/«Получил» need the key and a server with settlements
  const canSettle = useData((s) => s.hasSettlements) && canWriteKey;
  const [ask, setAsk] = useState<SettleAsk | null>(null);
  const open = useCallback<Ask>((a) => setAsk((prev) => ({ ...a, seq: (prev?.seq ?? 0) + 1 })), []);
  return (
    <>
      {me ? <ForMe me={me} L={L} tx={tx} name={name} onSettle={canSettle ? open : undefined} /> : <PickMe />}
      <Trip L={L} n={n} people={people.length} />
      <More L={L} tx={tx} people={people} name={name} meId={me?.id} />
      <SettleSheet ask={ask} onClose={() => setAsk(null)} name={name} />
    </>
  );
}

function PickMe() {
  return (
    <section className="t-card t-pick">
      <div className="t-k">Итоги для тебя</div>
      <p>Выбери себя — и здесь будет, сколько и кому переводить.</p>
      <button className="btn pri" type="button" onClick={() => openWho(true)}>
        Выбрать себя
      </button>
    </section>
  );
}

async function copyAmount(g: number) {
  const s = copyDec(g);
  haptic();
  try {
    await navigator.clipboard.writeText(s);
    toast("Скопировано");
  } catch {
    void showCopy("Скопируй сумму", s);
  }
}

function ForMe({ me, L, tx, name, onSettle }: { me: Person; L: Ledger; tx: Transfer[]; name: NameOf; onSettle?: Ask }) {
  const b = L.bal.get(me.id) ?? 0;
  const paid = L.paid.get(me.id) ?? 0;
  const owes = L.owes.get(me.id) ?? 0;
  const sent = L.sent.get(me.id) ?? 0;
  const got = L.received.get(me.id) ?? 0;
  const moved = [sent ? `перевёл ${fmtG(sent)}` : "", got ? `получил ${fmtG(got)}` : ""].filter(Boolean).join(" · ");
  const out = tx.filter((t) => t.from === me.id);
  const inc = tx.filter((t) => t.to === me.id);
  const label = b < 0 ? "Ты должен" : b > 0 ? "Ты получишь" : "Ты в расчёте";
  const nobody = !paid ? "никто — ты ничего не оплачивал" : b < 0 ? "никто — твоя доля больше, чем ты оплатил" : "все рассчитались";
  return (
    <>
      <section className="t-card t-me" aria-label="Итоги для тебя">
        <div className="t-k">
          <Morph>{label}</Morph>
        </div>
        <div className={`t-big num${b ? "" : " zero"}`}>
          <Morph>{fmtG(Math.abs(b))}</Morph>
        </div>
        <div className="t-s num">
          <Morph>{`потратил ${fmtG(paid)} · твоя доля ${fmtG(owes)}`}</Morph>
        </div>
        {moved && (
          <div className="t-s t-moved num">
            <Morph>{moved}</Morph>
          </div>
        )}
        {out.length > 0 && (
          <ul className="t-rows">
            {out.map((t) => (
              <li key={t.to}>
                <span className="t-who">
                  <i>→</i>
                  {name(t.to)}
                </span>
                <span className="t-amt num">
                  <Morph>{fmtDec(t.g)}</Morph>
                </span>
                <button
                  className="t-copy"
                  type="button"
                  aria-label={`Скопировать ${copyDec(t.g)} для ${name(t.to)}`}
                  onClick={() => void copyAmount(t.g)}
                >
                  скопировать
                </button>
                {onSettle && (
                  <button
                    className="t-copy pri"
                    type="button"
                    aria-label={`Перевёл ${name(t.to)} ${copyDec(t.g)}`}
                    onClick={() => onSettle({ from: me.id, to: t.to, g: t.g, dir: "out" })}
                  >
                    Перевёл
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="h2row">
        <h2>Тебе должны</h2>
      </div>
      <ul className="list t-list">
        {inc.length ? (
          inc.map((t) => (
            <li key={t.from}>
              <span className="t-who">
                {name(t.from)}
                <i>→</i>
              </span>
              <span className="t-amt num">
                <Morph>{fmtDec(t.g)}</Morph>
              </span>
              {onSettle && (
                <button
                  className="t-copy"
                  type="button"
                  aria-label={`Получил от ${name(t.from)} ${copyDec(t.g)}`}
                  onClick={() => onSettle({ from: t.from, to: me.id, g: t.g, dir: "in" })}
                >
                  Получил
                </button>
              )}
            </li>
          ))
        ) : (
          <li className="t-none">{nobody}</li>
        )}
      </ul>
    </>
  );
}

function Trip({ L, n, people }: { L: Ledger; n: number; people: number }) {
  const cats = useMemo(() => sortedCats(L.cats), [L]);
  const max = cats[0]?.[1] ?? 1;
  return (
    <>
      <div className="h2row">
        <h2>Поездка</h2>
        <span className="sec-n">
          {n} {plural(n, "чек", "чека", "чеков")}
        </span>
      </div>
      <section className="t-card t-trip">
        <div className="t-stats">
          <div>
            <span className="t-k">Всего потрачено</span>
            <b className="num">
              <Morph>{fmtG(L.total)}</Morph>
            </b>
          </div>
          <div>
            <span className="t-k">На человека</span>
            <b className="num">
              <Morph>{fmtG(Math.round(L.total / (people || 1)))}</Morph>
            </b>
          </div>
        </div>
        {cats.length > 0 && (
          <ul className="t-bars" aria-label="По категориям">
            {cats.map(([c, g]) => (
              <li key={c}>
                <div className="t-bl">
                  <span>{c}</span>
                  <b className="num">
                    <Morph>{fmtG(g)}</Morph>
                  </b>
                </div>
                <div className="t-track" aria-hidden="true">
                  <i style={{ transform: `scaleX(${Math.max(0.01, g / max).toFixed(4)})` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Spoiler({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <Collapsible.Root className="t-col">
      <Collapsible.Trigger className="t-trig">
        <span>
          {title}
          {count && <span className="t-n"> · {count}</span>}
        </span>
        <ChevronIcon />
      </Collapsible.Trigger>
      <Collapsible.Panel className="t-panel">
        <div className="t-pin">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

function Done({ name, meId }: { name: NameOf; meId?: string }) {
  const map = useSettlements();
  const list = useMemo(() => [...map.values()].sort((a, b) => String(b.created ?? "").localeCompare(String(a.created ?? ""))), [map]);
  if (!list.length) return null;
  const undo = async (t: Settlement) => {
    const ok = await confirmAction({
      title: "Отменить перевод?",
      body: `${name(t.from)} → ${name(t.to)}, ${fmtG(t.amount)}. Сумма снова появится в долгах — у всех.`,
      ok: "Да, отменить",
      danger: true,
    });
    if (ok) await deleteSettlement(t);
  };
  return (
    <Spoiler title="Переводы сделаны" count={String(list.length)}>
      <ul className="t-all t-done">
        {list.map((t) => (
          <li key={t.id} className={t.from === meId || t.to === meId ? "mine" : undefined}>
            <span className="t-who">
              {name(t.from)}
              <i>→</i>
              {name(t.to)}
              <small className="t-when">{fmtWhen(t.created)}</small>
            </span>
            <span className="t-amt num">{fmtDec(t.amount)}</span>
            {canWriteKey && (
              <button
                className="t-copy"
                type="button"
                disabled={t.tmp}
                aria-label={`Отменить перевод ${name(t.from)} → ${name(t.to)} ${copyDec(t.amount)}`}
                onClick={() => void undo(t)}
              >
                отменить
              </button>
            )}
          </li>
        ))}
      </ul>
    </Spoiler>
  );
}

function More({ L, tx, people, name, meId }: { L: Ledger; tx: Transfer[]; people: Person[]; name: NameOf; meId?: string }) {
  return (
    <div className="t-more">
      <Done name={name} meId={meId} />
      <Spoiler title="Осталось перевести" count={String(tx.length)}>
        {tx.length ? (
          <ul className="t-all">
            {tx.map((t) => (
              <li key={`${t.from}>${t.to}`} className={t.from === meId || t.to === meId ? "mine" : undefined}>
                <span className="t-who">
                  {name(t.from)}
                  <i>→</i>
                  {name(t.to)}
                </span>
                <span className="t-amt num">
                  <Morph>{fmtDec(t.g)}</Morph>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-none">Все в расчёте</p>
        )}
      </Spoiler>
      <Spoiler title="Баланс по людям">
        <table className="t-tbl num">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Кто</span>
              </th>
              <th scope="col">заплатил</th>
              <th scope="col">доля</th>
              <th scope="col">баланс</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const b = L.bal.get(p.id) ?? 0;
              return (
                <tr key={p.id} className={p.id === meId ? "mine" : undefined}>
                  <th scope="row">{p.name}</th>
                  <td>{fmtDec(L.paid.get(p.id) ?? 0)}</td>
                  <td>{fmtDec(L.owes.get(p.id) ?? 0)}</td>
                  <td className="t-bal">
                    <Morph>{fmtDecSigned(b)}</Morph>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="t-foot">В zł. Баланс — с учётом сделанных переводов: «+» — получит, «−» — должен перевести.</p>
      </Spoiler>
      <button className="t-trig" type="button" onClick={exportCsv}>
        <span>Скачать CSV</span>
      </button>
    </div>
  );
}

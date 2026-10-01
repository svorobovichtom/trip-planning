import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addItem, deleteItem, isCustomItem, requireWriter, toggleItem } from "../../lib/actions";
import { type Section, useReceiptMatch, useSections } from "../../lib/hooks";
import { fmtG, fmtMinus, grosze } from "../../lib/money";
import { canWriteKey } from "../../lib/pb";
import { actualQty, type ItemActual, type LineRef, lineQty } from "../../lib/receipt";
import { useData, useItems, usePeople } from "../../lib/stores";
import { LS, readJSON } from "../../lib/storage";
import type { Item, Person } from "../../lib/types";
import { CheckIcon, ChevronIcon, OfflineIcon } from "../../ui/icons";
import { Morph } from "../../ui/Morph";
import { Skeleton } from "../../ui/Skeleton";
import { secDomId } from "./SectionChips";
import { useGroupMoves } from "./useGroupMoves";
import "./list.css";

const EXTRA = "\u0000extra";
const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const parseDate = (s?: string) => (s ? new Date(String(s).replace(" ", "T")) : null);

/** Expanded «Куплено» groups, shared with the legacy page ("trip.got"). */
function useExpanded() {
  const [open, setOpen] = useState(() => new Set(readJSON<string[]>(LS, "trip.got", [])));
  const toggle = useCallback((name: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      LS.set("trip.got", next.size ? JSON.stringify([...next]) : null);
      return next;
    });
  }, []);
  return [open, toggle] as const;
}

export function ListPage() {
  const loaded = useData((s) => s.loaded);
  const loadFailed = useData((s) => s.loadFailed);
  const sections = useSections();
  const items = useItems();
  const people = usePeople();
  const match = useReceiptMatch();
  const [expanded, toggleExpanded] = useExpanded();
  const [adding, setAdding] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const isVisible = useCallback((id: string) => {
    const li = root.current?.querySelector(`[data-item="${CSS.escape(id)}"]`);
    return !!li && !li.closest(".bwrap:not(.on)");
  }, []);
  const moves = useGroupMoves(items, isVisible);
  const personName = useMemo(() => {
    const m = new Map(people.map((p) => [p.id, p.name]));
    return (id?: string) => (id ? m.get(id) : undefined);
  }, [people]);

  const onToggle = (it: Item) => {
    if (!requireWriter()) return;
    moves.hold(it.id, !!it.done);
    toggleItem(it.id);
  };

  if (!loaded) {
    return loadFailed ? (
      <div className="es list-err" role="status">
        <span className="es-i">
          <OfflineIcon />
        </span>
        <p className="es-t">Список не загрузился</p>
        <p className="es-b">Проверь интернет — страница попробует снова сама.</p>
      </div>
    ) : (
      <Skeleton label="Загружаю список" />
    );
  }

  return (
    <div ref={root}>
      {!canWriteKey && <div className="ro">Только просмотр. Чтобы отмечать, попроси ссылку с ключом.</div>}
      <main>
        {sections.map((s, i) => (
          <SectionView
            key={s.name}
            index={i}
            section={s}
            expanded={expanded.has(s.name)}
            onToggleExpanded={() => toggleExpanded(s.name)}
            adding={adding === s.name}
            onAdd={(on) => setAdding(on ? s.name : null)}
            onToggle={onToggle}
            moves={moves}
            actual={match.byItem}
            personName={personName}
          />
        ))}
      </main>
      <ExtraSection rows={match.extra} expanded={expanded.has(EXTRA)} onToggle={() => toggleExpanded(EXTRA)} people={people} />
    </div>
  );
}

type Moves = ReturnType<typeof useGroupMoves>;

function SectionView(props: {
  index: number;
  section: Section;
  expanded: boolean;
  onToggleExpanded: () => void;
  adding: boolean;
  onAdd: (on: boolean) => void;
  onToggle: (it: Item) => void;
  moves: Moves;
  actual: Map<string, ItemActual>;
  personName: (id?: string) => string | undefined;
}) {
  const { index, section: s, expanded, moves, actual } = props;
  const open: Item[] = [];
  const got: Item[] = [];
  for (const it of s.items) (moves.groupOf(it) ? got : open).push(it);
  const d = s.items.filter((it) => it.done).length;
  const t = s.items.length;
  const g = got.length;
  const gs = got.reduce((sum, it) => sum + (actual.get(it.id)?.g ?? 0), 0);
  const on = expanded && g > 0;
  const gotId = `got${index}`;

  return (
    <section id={secDomId(index)} className={t > 0 && d === t ? "all-done" : undefined} aria-labelledby={`sh${index}`}>
      <div className="sec-h">
        <h2 id={`sh${index}`}>{s.name}</h2>
        <Morph className="sec-n">{`${d} / ${t}`}</Morph>
      </div>
      <div className="card">
        {open.length > 0 && (
          <ul className="list open">
            {open.map((it) => (
              <ItemRow key={it.id} it={it} bought={false} {...props} />
            ))}
          </ul>
        )}
        <div className="add-li">
          {props.adding ? (
            <AddForm section={s.name} onDone={() => props.onAdd(false)} />
          ) : (
            <button className="add-btn" type="button" onClick={() => requireWriter() && props.onAdd(true)}>
              + добавить
            </button>
          )}
        </div>
        {g > 0 && (
          <button className="bought" type="button" aria-expanded={on} aria-controls={gotId} onClick={props.onToggleExpanded}>
            <Morph className="bt">{`${g === t ? "Всё куплено" : "Куплено"} · ${g}${gs ? ` · ${fmtG(gs)}` : ""}`}</Morph>
            <ChevronIcon />
          </button>
        )}
        <div className={`bwrap${on ? " on" : ""}`}>
          <div className="bin">
            <ul className="list got" id={gotId} inert={!on}>
              {got.map((it) => (
                <ItemRow key={it.id} it={it} bought {...props} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function ItemRow({
  it,
  bought,
  onToggle,
  moves,
  actual,
  personName,
}: {
  it: Item;
  bought: boolean;
  onToggle: (it: Item) => void;
  moves: Moves;
  actual: Map<string, ItemActual>;
  personName: (id?: string) => string | undefined;
}) {
  const done = !!it.done;
  const a = actual.get(it.id);
  const who = done ? personName(it.done_by) : undefined;
  let by = "";
  if (done) {
    const at = parseDate(it.done_at);
    by = (who ?? "кто-то") + (at && !Number.isNaN(at.getTime()) ? `, ${fmtTime.format(at)}` : "");
  }
  const phase = moves.phaseOf(it.id);
  const cls = ["it", phase === "fold" ? "fold" : "", moves.isLanding(it.id) ? "rowin" : ""].filter(Boolean).join(" ");
  return (
    <li className={cls} data-item={it.id}>
      <div className="it-in">
        <button className={`row${done ? " done" : ""}`} type="button" aria-pressed={done} onClick={() => onToggle(it)}>
          <span className="box">
            <CheckIcon />
          </span>
          <span className="txt">
            <span className="name">{it.name}</span>
            {!bought && it.pl ? <span className="pl">{it.pl}</span> : null}
            {!bought && by ? <span className="by">{by}</span> : null}
          </span>
          {bought && <span className="who">{who ?? ""}</span>}
          <span className="qty">{bought ? actualQty(it, a) : it.qty || ""}</span>
          {bought && <span className="pr">{a && a.lines.length ? fmtG(a.g) : "—"}</span>}
        </button>
        {isCustomItem(it) && (
          <button className="del" type="button" aria-label={`Удалить ${it.name}`} onClick={() => void deleteItem(it.id)}>
            ×
          </button>
        )}
      </div>
    </li>
  );
}

function AddForm({ section, onDone }: { section: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  return (
    <form
      className="add-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        const ok = await addItem(section, String(f.get("name") ?? ""), String(f.get("qty") ?? ""));
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <input ref={nameRef} className="in" name="name" placeholder="Что купить" aria-label="Что купить" required maxLength={120} autoComplete="off" enterKeyHint="done" />
      <input className="in" name="qty" placeholder="Сколько" aria-label="Сколько" maxLength={40} autoComplete="off" />
      <div className="act">
        <button className="btn" type="button" onClick={onDone}>
          Отмена
        </button>
        <button className="btn pri" type="submit" disabled={busy}>
          Добавить
        </button>
      </div>
    </form>
  );
}

/** Receipt lines that matched nothing on the list. */
function ExtraSection({ rows, expanded, onToggle, people }: { rows: LineRef[]; expanded: boolean; onToggle: () => void; people: Person[] }) {
  if (!rows.length) return null;
  const sum = rows.reduce((t, r) => t + grosze(r.line.price), 0);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "";
  return (
    <section className="extra" aria-label="Сверх списка">
      <div className="card">
        <button className="bought solo" type="button" aria-expanded={expanded} aria-controls="extraL" onClick={onToggle}>
          <Morph className="bt">{`Сверх списка · ${rows.length} · ${fmtG(sum)}`}</Morph>
          <ChevronIcon />
        </button>
        <div className={`bwrap${expanded ? " on" : ""}`}>
          <div className="bin">
            <ul className="list got" id="extraL" inert={!expanded}>
              {rows.map((r) => (
                <li key={`${r.expense.id}:${r.index}`}>
                  <div className="row">
                    <span className="txt">
                      <span className="name">{r.line.text}</span>
                    </span>
                    <span className="who">{name(r.expense.paid_by)}</span>
                    <span className="qty">{lineQty(r.line)}</span>
                    <span className="pr">{r.line.price == null ? "—" : fmtMinus(grosze(r.line.price))}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

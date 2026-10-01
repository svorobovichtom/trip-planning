// «Поездка»: the house (address → Maps, dates, Wi-Fi with one-tap copy,
// other info), the menu as a small day timeline, and shared notes. Live and
// editable by everyone with the key; opened as a nested sheet from the
// profile. Data: house/meals/notes (pb_migrations/1790000008_trip.js), which
// are readable only with the key, so phones without it see an explanation.
// One editor is open at a time (`editing`); edits are queued like renames.
import { type ReactNode, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { canWriteKey } from "../../lib/pb";
import { useData, useLoaded, usePeople } from "../../lib/stores";
import {
  addMeal,
  addNote,
  deleteMeal,
  deleteNote,
  type HouseFields,
  type MealFields,
  saveHouse,
  updateMeal,
  updateNote,
} from "../../lib/tripActions";
import type { House, Meal, Note } from "../../lib/types";
import { Avatar } from "../../ui/Avatar";
import { Sheet } from "../../ui/Sheet";
import { copyText } from "../totals/copy";
import { groupDays, mapsUrl, relTime } from "./logic";
import "./trip.css";

/** "house" | "meal:<id>" | "meal:new" | "note:<id>" | null */
type Editing = string | null;

export function TripSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setEditing(null);
        onOpenChange(o);
      }}
      title="Поездка"
      className="tr-sheet"
      keyboard
    >
      <TripBody editing={editing} setEditing={setEditing} />
    </Sheet>
  );
}

function TripBody({ editing, setEditing }: { editing: Editing; setEditing: (e: Editing) => void }) {
  const hasTrip = useData((s) => s.hasTrip);
  const loaded = useLoaded();
  // open an editor within the tap, so iOS shows the keyboard for its autofocus
  const edit = (e: Editing) => flushSync(() => setEditing(e));
  const done = () => setEditing(null);

  if (!canWriteKey) {
    return <p className="lead tr-lead">Дом, Wi‑Fi, меню и заметки видны только по ссылке с ключом — попроси её у группы.</p>;
  }
  if (!hasTrip) {
    return <p className="lead tr-lead">{loaded ? "Скоро здесь будут дом, меню и заметки." : "Загружаем…"}</p>;
  }
  return (
    <>
      <HouseSection editing={editing === "house"} onEdit={() => edit("house")} onDone={done} />
      <MenuSection editing={editing} onEdit={edit} onDone={done} />
      <NotesSection editing={editing} onEdit={edit} onDone={done} />
    </>
  );
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="tr-h">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

// ---------- Дом ----------

function HouseSection({ editing, onEdit, onDone }: { editing: boolean; onEdit: () => void; onDone: () => void }) {
  const house = useData((s) => s.house);
  const h: House = house ?? { id: "" };
  const empty = !h.address && !h.dates && !h.wifi_name && !h.wifi_pass && !h.info;
  return (
    <section aria-label="Дом">
      <Head title="Дом">
        {!editing && !empty && (
          <button className="link tr-edit" type="button" onClick={onEdit}>
            Изменить
          </button>
        )}
      </Head>
      {editing ? (
        <HouseForm house={h} onDone={onDone} />
      ) : empty ? (
        <button className="tr-card tr-empty" type="button" onClick={onEdit}>
          <span className="tr-ico" aria-hidden="true">
            <HomeIcon />
          </span>
          <span className="tr-et">
            <span className="tr-e1">Добавь адрес и Wi‑Fi</span>
            <span className="tr-e2">Код от двери, контакт хозяина, правила — тоже сюда</span>
          </span>
        </button>
      ) : (
        <div className="tr-card tr-house">
          {h.address && (
            <a className="tr-row tr-addr" href={mapsUrl(h.address)} target="_blank" rel="noopener noreferrer">
              <span className="tr-ico" aria-hidden="true">
                <PinIcon />
              </span>
              <span className="tr-rt">
                <span className="tr-r1">{h.address}</span>
                <span className="tr-r2">Открыть в Картах</span>
              </span>
              <ArrowIcon />
            </a>
          )}
          {h.dates && (
            <div className="tr-row">
              <span className="tr-ico" aria-hidden="true">
                <CalIcon />
              </span>
              <span className="tr-rt">
                <span className="tr-r1">{h.dates}</span>
              </span>
            </div>
          )}
          {(h.wifi_name || h.wifi_pass) && <Wifi name={h.wifi_name ?? ""} pass={h.wifi_pass ?? ""} />}
          {h.info && <p className="tr-info">{h.info}</p>}
        </div>
      )}
    </section>
  );
}

function Wifi({ name, pass }: { name: string; pass: string }) {
  const value = pass || name;
  return (
    <button
      className="tr-wifi"
      type="button"
      aria-label={`Wi‑Fi ${name}${pass ? `, пароль ${pass}` : ""}. Скопировать ${pass ? "пароль" : "название"}`}
      onClick={() => void copyText(value, pass ? "Пароль Wi‑Fi" : "Сеть Wi‑Fi")}
    >
      <span className="tr-ico" aria-hidden="true">
        <WifiIcon />
      </span>
      <span className="tr-wt">
        <span className="tr-wn">{name ? `Wi‑Fi · ${name}` : "Wi‑Fi"}</span>
        {pass && <span className="tr-wp">{pass}</span>}
      </span>
      <span className="tr-copy" aria-hidden="true">
        <CopyIcon />
      </span>
    </button>
  );
}

function HouseForm({ house, onDone }: { house: House; onDone: () => void }) {
  return (
    <form
      className="tr-card tr-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: keyof HouseFields) => String(f.get(k) ?? "");
        saveHouse({ address: v("address"), dates: v("dates"), wifi_name: v("wifi_name"), wifi_pass: v("wifi_pass"), info: v("info") });
        onDone();
      }}
    >
      <Field label="Адрес">
        <input className="in" name="address" defaultValue={house.address} maxLength={200} autoComplete="off" autoFocus placeholder="ул. Лесная 5, Закопане" />
      </Field>
      <Field label="Даты и заезд">
        <input className="in" name="dates" defaultValue={house.dates} maxLength={120} autoComplete="off" placeholder="пт 16:00 → вс 11:00" />
      </Field>
      <div className="tr-two">
        <Field label="Wi‑Fi">
          <input className="in" name="wifi_name" defaultValue={house.wifi_name} maxLength={64} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="сеть" />
        </Field>
        <Field label="Пароль">
          <input className="in" name="wifi_pass" defaultValue={house.wifi_pass} maxLength={64} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="пароль" />
        </Field>
      </div>
      <Field label="Ещё">
        <textarea className="in tr-ta" name="info" defaultValue={house.info} maxLength={2000} rows={3} placeholder="Код от двери, контакт хозяина, правила" />
      </Field>
      <FormButtons onCancel={onDone} />
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="tr-f">
      <span className="tr-fl">{label}</span>
      {children}
    </label>
  );
}

function FormButtons({ onCancel, onDelete, ok = "Сохранить" }: { onCancel: () => void; onDelete?: () => void; ok?: string }) {
  return (
    <div className="tr-btns">
      {onDelete && (
        <button className="link bad tr-del" type="button" onClick={onDelete}>
          Удалить
        </button>
      )}
      <button className="btn" type="button" onClick={onCancel}>
        Отмена
      </button>
      <button className="btn pri" type="submit">
        {ok}
      </button>
    </div>
  );
}

// ---------- Меню ----------

const MEAL_HINTS = ["завтрак", "обед", "ужин", "перекус"];

function MenuSection({ editing, onEdit, onDone }: { editing: Editing; onEdit: (e: Editing) => void; onDone: () => void }) {
  const meals = useData((s) => s.meals);
  const days = useMemo(() => groupDays(meals.values()), [meals]);
  const lastDay = days.at(-1)?.day ?? "";
  return (
    <section aria-label="Меню">
      <Head title="Меню" />
      <div className="tr-card tr-menu">
        {!days.length && editing !== "meal:new" && <p className="tr-none">Меню пока пустое</p>}
        {days.map((d) => (
          <div className="tr-day" key={d.day.toLowerCase()}>
            <h3 className="tr-dayh">{d.day}</h3>
            <ol className="tr-tl">
              {d.meals.map((m) =>
                editing === `meal:${m.id}` ? (
                  <li key={m.id} className="tr-m tr-m-ed">
                    <MealForm days={days.map((x) => x.day)} meal={m} onDone={onDone} />
                  </li>
                ) : (
                  <li key={m.id} className="tr-m">
                    <button className="tr-mb" type="button" aria-label={`${m.meal || "Блюдо"}: ${m.dish}. Изменить`} onClick={() => onEdit(`meal:${m.id}`)}>
                      {m.meal && <span className="tr-ml">{m.meal}</span>}
                      <span className="tr-md">{m.dish}</span>
                    </button>
                  </li>
                ),
              )}
            </ol>
          </div>
        ))}
        {editing === "meal:new" ? (
          <div className="tr-m-new">
            <MealForm days={days.map((x) => x.day)} defaultDay={lastDay} onDone={onDone} />
          </div>
        ) : (
          <button className="tr-add" type="button" onClick={() => onEdit("meal:new")}>
            <PlusIcon />
            Добавить блюдо
          </button>
        )}
      </div>
    </section>
  );
}

function MealForm({ days, meal, defaultDay = "", onDone }: { days: string[]; meal?: Meal; defaultDay?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const id = meal?.id ?? "new";
  return (
    <form
      className="tr-form tr-mform"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v: MealFields = { day: String(f.get("day") ?? ""), meal: String(f.get("meal") ?? ""), dish: String(f.get("dish") ?? "") };
        if (meal) {
          updateMeal(meal.id, v);
          onDone();
          return;
        }
        setBusy(true);
        const ok = await addMeal(v);
        setBusy(false);
        if (ok) onDone();
      }}
    >
      <div className="tr-two">
        <Field label="День">
          <input className="in" name="day" list={`tr-days-${id}`} defaultValue={meal?.day ?? defaultDay} maxLength={30} required autoComplete="off" placeholder="Пятница" />
        </Field>
        <Field label="Приём пищи">
          <input className="in" name="meal" list={`tr-meals-${id}`} defaultValue={meal?.meal ?? ""} maxLength={30} autoComplete="off" placeholder="ужин" />
        </Field>
      </div>
      <datalist id={`tr-days-${id}`}>
        {days.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <datalist id={`tr-meals-${id}`}>
        {MEAL_HINTS.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <Field label="Что едим">
        <textarea className="in tr-ta" name="dish" defaultValue={meal?.dish ?? ""} maxLength={300} rows={3} required autoFocus placeholder="Гриль: шея, курица, салат" />
      </Field>
      <FormButtons
        onCancel={onDone}
        ok={meal ? "Сохранить" : busy ? "Добавляем…" : "Добавить"}
        onDelete={meal ? () => void deleteMeal(meal.id).then((ok) => ok && onDone()) : undefined}
      />
    </form>
  );
}

// ---------- Заметки ----------

function NotesSection({ editing, onEdit, onDone }: { editing: Editing; onEdit: (e: Editing) => void; onDone: () => void }) {
  const notes = useData((s) => s.notes);
  const people = usePeople();
  const list = useMemo(() => [...notes.values()].sort((a, b) => String(a.created ?? "").localeCompare(String(b.created ?? ""))), [notes]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  return (
    <section aria-label="Заметки">
      <Head title="Заметки" />
      <ul className="tr-notes">
        {list.map((n) => (
          <li key={n.id} className="tr-card tr-note">
            {editing === `note:${n.id}` ? (
              <NoteForm note={n} onDone={onDone} />
            ) : (
              <button className="tr-nb" type="button" onClick={() => onEdit(`note:${n.id}`)} aria-label={`${n.text}. Изменить`}>
                <span className="tr-nt">{n.text}</span>
                <NoteMeta note={n} name={n.author ? byId.get(n.author)?.name : undefined} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <NewNote />
    </section>
  );
}

function NoteMeta({ note, name }: { note: Note; name?: string }) {
  const when = relTime(note.created);
  return (
    <span className="tr-meta">
      {name && note.author && <Avatar person={{ id: note.author }} size={18} />}
      <span>{[name, when].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

function NoteForm({ note, onDone }: { note: Note; onDone: () => void }) {
  return (
    <form
      className="tr-form tr-nform"
      onSubmit={(e) => {
        e.preventDefault();
        updateNote(note.id, String(new FormData(e.currentTarget).get("text") ?? ""));
        onDone();
      }}
    >
      <textarea className="in tr-ta" name="text" aria-label="Заметка" defaultValue={note.text} maxLength={1000} rows={4} required autoFocus />
      <FormButtons onCancel={onDone} onDelete={() => void deleteNote(note.id).then((ok) => ok && onDone())} />
    </form>
  );
}

function NewNote() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="tr-new"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        const ok = await addNote(text);
        setBusy(false);
        if (ok) setText("");
      }}
    >
      <textarea
        className="in tr-ta"
        name="text"
        aria-label="Новая заметка"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder="Новая заметка для всех…"
      />
      {text.trim() && (
        <button className="btn pri" type="submit" disabled={busy}>
          Добавить
        </button>
      )}
    </form>
  );
}

// ---------- icons (24px grid, 1.6 stroke, like ReceiptIcon) ----------

const I = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const HomeIcon = () => (
  <I>
    <path d="M4 10.5 12 4l8 6.5V20H4z" />
    <path d="M10 20v-5h4v5" />
  </I>
);
const PinIcon = () => (
  <I>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </I>
);
const CalIcon = () => (
  <I>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
  </I>
);
const WifiIcon = () => (
  <I>
    <path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.4a4 4 0 0 1 6 0" />
    <circle cx="12" cy="19.3" r="0.6" fill="currentColor" />
  </I>
);
const CopyIcon = () => (
  <I>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
    <path d="M15.5 8.5V6.5A2 2 0 0 0 13.5 4.5h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
  </I>
);
const ArrowIcon = () => (
  <I>
    <path d="M8 16 16 8M9.5 8H16v6.5" />
  </I>
);
const PlusIcon = () => (
  <I>
    <path d="M12 5v14M5 12h14" />
  </I>
);

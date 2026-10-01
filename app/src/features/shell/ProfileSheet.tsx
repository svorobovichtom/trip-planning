// The profile: the one sheet behind the header pill. Main step: me (rename,
// «Сменить»), my money in one line (→ «Итоги»), how to pay me, the trip
// (house/menu/notes, participants, share link), CSV and «Снять все отметки». The «Кто
// ты?» step (new name / pick yourself) is the same sheet; opened directly
// (first visit, «Кто ты?» pill, a write without a person) it closes after
// choosing, reached via «Сменить» it returns to the main step.
// Read-only phones (no key) see everything but the editors and writes.
import { useRef, useState } from "react";
import { doneCount, joinAs, renamePerson, resetAllItems, setMe } from "../../lib/actions";
import { useLedger, useListStats } from "../../lib/hooks";
import { fmtG } from "../../lib/money";
import { canWriteKey, shareUrl } from "../../lib/pb";
import { plural } from "../../lib/plural";
import {
  closeProfile,
  setProfileStep,
  setTab,
  useExpenses,
  useMe,
  usePeople,
  useUi,
} from "../../lib/stores";
import type { Person } from "../../lib/types";
import { Avatar } from "../../ui/Avatar";
import { confirmAction, showCopy } from "../../ui/Confirm";
import { ChevronIcon } from "../../ui/icons";
import { Sheet } from "../../ui/Sheet";
import { toast } from "../../ui/toast";
import { exportCsv } from "../totals/csv";
import { TripSheet } from "../trip/TripSheet";
import { type PayKind, PayRows } from "./PayForm";

type Sub = "trip" | "people" | null;

export function ProfileSheet() {
  const open = useUi((s) => s.profileOpen);
  const step = useUi((s) => s.profileStep);
  const payReq = useUi((s) => s.profilePay);
  const me = useMe();
  const nameRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLInputElement>(null);
  const [sub, setSub] = useState<Sub>(null);
  const [editing, setEditing] = useState<PayKind | null>(null);
  const [renaming, setRenaming] = useState(false);
  // «Укажи Revolut или телефон» in «Итоги» opens the Revolut row
  const [seenPay, setSeenPay] = useState(0);
  if (payReq && payReq !== seenPay) {
    setSeenPay(payReq);
    setEditing("revolut");
  }
  const who = step === "who";

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        closeProfile();
        setSub(null);
        setEditing(null);
        setRenaming(false);
      }}
      title={who ? "Кто ты?" : "Профиль"}
      className="pf-sheet"
      initialFocus={who ? (canWriteKey ? nameRef : undefined) : payReq && canWriteKey ? payRef : undefined}
      keyboard
    >
      {who ? (
        <WhoStep nameRef={nameRef} />
      ) : (
        <MainStep
          me={me}
          editing={editing}
          setEditing={setEditing}
          renaming={renaming}
          setRenaming={setRenaming}
          payRef={payRef}
          onSub={setSub}
        />
      )}
      <TripSheet open={sub === "trip"} onOpenChange={(o) => !o && setSub(null)} />
      <Sheet open={sub === "people"} onOpenChange={(o) => !o && setSub(null)} title={<PeopleTitle />}>
        <PeopleList meId={me?.id} />
      </Sheet>
    </Sheet>
  );
}

// ---------- main step ----------

function MainStep({ me, editing, setEditing, renaming, setRenaming, payRef, onSub }: {
  me?: Person;
  editing: PayKind | null;
  setEditing: (k: PayKind | null) => void;
  renaming: boolean;
  setRenaming: (on: boolean) => void;
  payRef: React.RefObject<HTMLInputElement | null>;
  onSub: (s: Sub) => void;
}) {
  const people = usePeople();
  const { done } = useListStats();
  const n = people.length;
  const share = async () => {
    const url = shareUrl();
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: "Покупки и расходы поездки", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Ссылка скопирована");
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") void showCopy("Скопируй ссылку", url);
    }
  };
  const reset = async () => {
    const k = doneCount();
    if (!k) return toast("Отметок нет");
    const ok = await confirmAction({
      title: `Снять ${k} ${plural(k, "отметку", "отметки", "отметок")}?`,
      body: "Все пункты списка снова станут некупленными — у всех.",
      ok: "Снять",
      danger: true,
    });
    if (!ok) return;
    const got = resetAllItems();
    closeProfile();
    if (got) toast(`Снято отметок: ${got}`);
  };
  const showPay = me && (canWriteKey || me.revolut || me.phone);

  return (
    <>
      <div className="pf-id">
        <Avatar person={me} size={44} />
        <div className="pf-idt">
          {me && renaming && canWriteKey ? (
            <form
              className="join pf-rename"
              onSubmit={(e) => {
                e.preventDefault();
                renamePerson(me.id, String(new FormData(e.currentTarget).get("name") ?? ""));
                setRenaming(false);
              }}
            >
              <input
                className="in"
                name="name"
                defaultValue={me.name}
                maxLength={40}
                aria-label="Твоё имя"
                autoComplete="off"
                enterKeyHint="done"
                required
                autoFocus
              />
              <button className="btn pri" type="submit">
                Сохранить
              </button>
            </form>
          ) : me && canWriteKey ? (
            <button className="pf-name" type="button" aria-label={`${me.name}. Исправить имя`} onClick={() => setRenaming(true)}>
              {me.name}
            </button>
          ) : (
            <span className={`pf-name${me ? "" : " none"}`}>{me ? me.name : "Ты ещё не выбран"}</span>
          )}
          {!renaming && (
            <span className="pf-sub">
              в поездке · {n} {plural(n, "человек", "человека", "человек")}
            </span>
          )}
        </div>
        {!renaming && (
          <button className={me ? "link pf-switch" : "btn pri pf-switch"} type="button" onClick={() => setProfileStep("who")}>
            {me ? "Сменить" : "Выбрать себя"}
          </button>
        )}
      </div>

      {me && <Money me={me} />}

      {showPay && (
        <>
          <h2>Как тебе переводить</h2>
          <PayRows me={me} editing={editing} onEdit={setEditing} firstRef={payRef} readOnly={!canWriteKey} />
          <p className="note pf-note">Revtag и телефон видны всем, у кого есть ссылка на поездку.</p>
        </>
      )}

      <h2>Поездка</h2>
      <ul className="list acts">
        <li>
          <button className="prow" type="button" aria-haspopup="dialog" onClick={() => onSub("trip")}>
            <span className="nm">Дом, меню и заметки</span>
            <ChevronIcon />
          </button>
        </li>
        <li>
          <button className="prow" type="button" aria-haspopup="dialog" onClick={() => onSub("people")}>
            <span className="nm">
              Участники <span className="pf-n">· {n}</span>
            </span>
            <ChevronIcon />
          </button>
        </li>
        {canWriteKey && (
          <li>
            <button className="prow" type="button" onClick={share}>
              <span className="nm">Ссылка для группы</span>
              <span className="cur">поделиться</span>
            </button>
          </li>
        )}
      </ul>

      <ul className="list acts">
        <li>
          <button
            className="prow"
            type="button"
            onClick={() => {
              closeProfile();
              exportCsv();
            }}
          >
            <span className="nm">Скачать расходы</span>
            <span className="cur">CSV</span>
          </button>
        </li>
        {canWriteKey && (
          <li>
            <button className="prow pf-danger" type="button" onClick={() => void reset()}>
              <span className="nm">Снять все отметки</span>
              <span className="cur">{done ? String(done) : ""}</span>
            </button>
          </li>
        )}
      </ul>
      <p className="build">сборка {__BUILD__}</p>
    </>
  );
}

/** My balance in one line; opens «Итоги». */
function Money({ me }: { me: Person }) {
  const L = useLedger();
  const n = useExpenses().size;
  const b = L.bal.get(me.id) ?? 0;
  const label = !n ? "Чеков пока нет" : b < 0 ? `Ты должен ${fmtG(-b)}` : b > 0 ? `Тебе должны ${fmtG(b)}` : "Ты в расчёте";
  return (
    <button
      className="pf-money"
      type="button"
      onClick={() => {
        setTab("sum");
        closeProfile();
      }}
    >
      <span className="pf-mt">
        <span className={`pf-mb num${n && b ? "" : " zero"}`}>{label}</span>
        {n > 0 && (
          <span className="pf-ms num">
            потратил {fmtG(L.paid.get(me.id) ?? 0)} · доля {fmtG(L.owes.get(me.id) ?? 0)}
          </span>
        )}
      </span>
      <span className="pf-go">
        Итоги
        <ChevronIcon />
      </span>
    </button>
  );
}

// ---------- «Кто ты?» step ----------

function WhoStep({ nameRef }: { nameRef: React.RefObject<HTMLInputElement | null> }) {
  const people = usePeople();
  const me = useMe();
  const entry = useUi((s) => s.profileEntry);
  const [busy, setBusy] = useState(false);
  const has = people.length > 0;
  // opened directly: done; via «Сменить»: back to the profile
  const after = () => (entry === "who" ? closeProfile() : setProfileStep("main"));
  return (
    <>
      <p className="lead">Имя будет видно рядом с тем, что ты отметишь и оплатишь.</p>
      {canWriteKey && (
        <>
          <h2>
            <label htmlFor="joinName">{has ? "Впервые здесь? Впиши своё имя" : "Как тебя зовут?"}</label>
          </h2>
          <form
            className="join"
            onSubmit={async (e) => {
              e.preventDefault();
              const input = nameRef.current;
              if (!input) return;
              setBusy(true);
              const ok = await joinAs(input.value);
              setBusy(false);
              if (ok) {
                input.value = "";
                input.blur();
                after();
              }
            }}
          >
            <input
              ref={nameRef}
              className="in"
              id="joinName"
              name="name"
              placeholder="Имя"
              maxLength={40}
              autoComplete="given-name"
              enterKeyHint="done"
              required
            />
            <button className="btn pri" type="submit" disabled={busy}>
              Это я
            </button>
          </form>
        </>
      )}
      {has && (
        <>
          <h2 id="whoListH">{canWriteKey ? "Уже заходил — выбери себя" : "Выбери себя"}</h2>
          <ul className="list pf-people" aria-labelledby="whoListH">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  className="prow"
                  type="button"
                  aria-pressed={p.id === me?.id}
                  onClick={() => {
                    if (p.id !== me?.id) setMe(p.id);
                    after();
                  }}
                >
                  <Avatar person={p} size={28} />
                  <span className="nm">{p.name}</span>
                  {p.id === me?.id && <span className="cur">это ты</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="foot">
        <button className="link" type="button" onClick={() => setProfileStep("main")}>
          {entry === "main" ? "← Назад" : "Меню поездки, участники и CSV"}
        </button>
      </div>
    </>
  );
}

// ---------- nested sheets ----------

function PeopleTitle() {
  const n = usePeople().length;
  return <>Участники · {n}</>;
}

function PeopleList({ meId }: { meId?: string }) {
  const people = usePeople();
  return (
    <>
      <ul className="list pf-people">
        {people.map((p) => {
          const pay = [p.revolut && "Revolut", p.phone && "BLIK"].filter(Boolean).join(" · ");
          return (
            <li key={p.id} className="pf-pp">
              <Avatar person={p} size={28} />
              <span className="pf-ppt">
                <span className="nm">{p.name}</span>
                <span className={`pf-ppay${pay ? "" : " none"}`}>{pay || "способ перевода не указан"}</span>
              </span>
              {p.id === meId && <span className="cur">это ты</span>}
            </li>
          );
        })}
      </ul>
      <p className="note">Revolut и BLIK — можно перевести этому человеку в один тап из «Итогов».</p>
    </>
  );
}

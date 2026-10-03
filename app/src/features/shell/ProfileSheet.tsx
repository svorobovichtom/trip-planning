// The profile: the one sheet behind the header pill. Main step: me (rename,
// «Сменить»), my money in one line (→ «Итоги»), how to pay me, the trip
// (house/menu/notes, participants, share link), CSV and «Снять все отметки».
// «Рассчитываемся вместе» (nested sheet): who settles together with me —
// tick people into my group, pick who transfers for it, or leave. The «Кто
// ты?» step (new name / pick yourself) is the same sheet; opened directly
// (first visit, «Кто ты?» pill, a write without a person) it closes after
// choosing, reached via «Сменить» it returns to the main step.
// Read-only phones (no key) see everything but the editors and writes.
import { useRef, useState } from "react";
import { doneCount, joinAs, renamePerson, resetAllItems, setMe, setWallets } from "../../lib/actions";
import { groupLabel, groupOf, headOf, leaveGroup, makeHead, toggleMember } from "../../lib/groups";
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
import { CheckIcon, ChevronIcon } from "../../ui/icons";
import { Sheet } from "../../ui/Sheet";
import { toast } from "../../ui/toast";
import { exportCsv } from "../totals/csv";
import { TripSheet } from "../trip/TripSheet";
import { type PayKind, PayRows } from "./PayForm";

type Sub = "trip" | "people" | "group" | null;

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
      <Sheet open={sub === "group"} onOpenChange={(o) => !o && setSub(null)} title="Рассчитываемся вместе">
        {me && <GroupEditor me={me} />}
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
      {me && n > 1 && <Together me={me} onOpen={() => onSub("group")} />}

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

/** My balance in one line (my group's when we settle together); opens «Итоги». */
function Money({ me }: { me: Person }) {
  const L = useLedger();
  const n = useExpenses().size;
  const head = L.head.get(me.id) ?? me.id;
  const we = (L.members.get(head)?.length ?? 1) > 1;
  const b = L.gbal.get(head) ?? 0;
  const ids = L.members.get(head) ?? [me.id];
  const sumOf = (m: Map<string, number>) => ids.reduce((s, id) => s + (m.get(id) ?? 0), 0);
  const label = !n
    ? "Чеков пока нет"
    : we
      ? b < 0 ? `Вы должны ${fmtG(-b)}` : b > 0 ? `Вам должны ${fmtG(b)}` : "Вы в расчёте"
      : b < 0 ? `Ты должен ${fmtG(-b)}` : b > 0 ? `Тебе должны ${fmtG(b)}` : "Ты в расчёте";
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
            {we ? "потратили" : "потратил"} {fmtG(sumOf(L.paid))} · доля {fmtG(sumOf(L.owes))}
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

/** «Рассчитываемся вместе» row: who I'm in a group with; opens the editor. */
function Together({ me, onOpen }: { me: Person; onOpen: () => void }) {
  const people = usePeople();
  const ids = groupOf(people, me.id);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  const others = ids.filter((id) => id !== me.id).map(name).join(", ");
  return (
    <ul className="list acts pf-tog">
      <li>
        <button className="prow" type="button" aria-haspopup="dialog" onClick={onOpen}>
          <span className="nm">Рассчитываемся вместе</span>
          <span className="cur">{others ? `с: ${others}` : "нет"}</span>
          <ChevronIcon />
        </button>
      </li>
    </ul>
  );
}

/**
 * Tick who settles together with me (one group, one balance, one transfer),
 * pick who transfers for the group, or leave it. Read-only without the key.
 */
function GroupEditor({ me }: { me: Person }) {
  const people = usePeople();
  const head = headOf(people, me.id);
  const mine = groupOf(people, me.id);
  const we = mine.length > 1;
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  const label = (id: string) => {
    const h = headOf(people, id);
    return groupLabel(h, groupOf(people, id), name);
  };
  const ro = !canWriteKey;
  return (
    <>
      <p className="lead">
        Для пары или семьи: долги складываются, и переводит и получает один человек за всех. Доли в чеках остаются у каждого
        свои.
      </p>
      <h2 id="grpH">С кем ты рассчитываешься</h2>
      <ul className="list pf-people pf-grp" aria-labelledby="grpH">
        {people
          .filter((p) => p.id !== me.id)
          .map((p) => {
            const on = mine.includes(p.id);
            const other = !on && groupOf(people, p.id).length > 1;
            return (
              <li key={p.id}>
                <button
                  className="prow"
                  type="button"
                  aria-pressed={on}
                  disabled={ro}
                  onClick={() => setWallets(toggleMember(people, me.id, p.id, !on))}
                >
                  <span className="pbox" aria-hidden="true">
                    <CheckIcon />
                  </span>
                  <Avatar person={p} size={28} />
                  <span className="pf-ppt">
                    <span className="nm">{p.name}</span>
                    {other && <span className="pf-ppay">сейчас вместе: {label(p.id)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
      </ul>
      {we && (
        <>
          <h2 id="grpHead">Кто переводит за всех</h2>
          <ul className="list pf-people" aria-labelledby="grpHead">
            {mine.map((id) => {
              const p = people.find((x) => x.id === id);
              return (
                <li key={id}>
                  <button
                    className="prow"
                    type="button"
                    aria-pressed={id === head}
                    disabled={ro}
                    onClick={() => setWallets(makeHead(people, id))}
                  >
                    <Avatar person={p} size={28} />
                    <span className="nm">{p?.name ?? "?"}</span>
                    {id === head && <span className="cur">переводит</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="note">
            Его Revolut и BLIK увидят в «Итогах». Отметить перевод может любой из вас — он засчитается всей группе.
          </p>
          {!ro && (
            <div className="foot">
              <button className="link pf-leave" type="button" onClick={() => setWallets(leaveGroup(people, me.id))}>
                Рассчитываться отдельно
              </button>
            </div>
          )}
        </>
      )}
    </>
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

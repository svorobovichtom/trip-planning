import { useRef, useState } from "react";
import { joinAs, renamePerson, setMe } from "../../lib/actions";
import { canWriteKey } from "../../lib/pb";
import { openWho, useMe, usePeople, useUi } from "../../lib/stores";
import { Sheet } from "../../ui/Sheet";

/** «Кто ты?»: new name first, then «Уже заходил — выбери себя», rename own name. */
export function WhoSheet() {
  const open = useUi((s) => s.whoOpen);
  const people = usePeople();
  const me = useMe();
  const nameRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const close = () => openWho(false);
  const has = people.length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        openWho(o);
        if (!o) setRenaming(false);
      }}
      title="Кто ты?"
      initialFocus={canWriteKey ? nameRef : undefined}
      keyboard
    >
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
                close();
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
          <ul className="list" aria-labelledby="whoListH">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  className="prow"
                  type="button"
                  aria-pressed={p.id === me?.id}
                  onClick={() => {
                    setMe(p.id);
                    close();
                  }}
                >
                  <span className="nm">{p.name}</span>
                  {p.id === me?.id && <span className="cur">это ты</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {canWriteKey && me && (
        <div className="foot">
          {renaming ? (
            <form
              className="join rename"
              onSubmit={(e) => {
                e.preventDefault();
                const v = String(new FormData(e.currentTarget).get("name") ?? "");
                renamePerson(me.id, v);
                setRenaming(false);
              }}
            >
              <input className="in" name="name" defaultValue={me.name} maxLength={40} aria-label="Твоё имя" autoComplete="off" enterKeyHint="done" required autoFocus />
              <button className="btn pri" type="submit">
                Сохранить
              </button>
            </form>
          ) : (
            <button className="link" type="button" onClick={() => setRenaming(true)}>
              Исправить моё имя
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

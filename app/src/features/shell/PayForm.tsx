// «Как тебе переводить» in the profile: my Revtag and BLIK phone, so «Ты
// должен» on other phones can open the transfer in one tap. Each row edits
// in place; a pasted «@name» or revolut.me link is fine (lib/pay.ts
// normalises it). Saved through the offline queue like a rename.
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { setPayInfo } from "../../lib/actions";
import { normPhone, normRevtag } from "../../lib/pay";
import type { Person } from "../../lib/types";
import { ChevronIcon } from "../../ui/icons";
import { toast } from "../../ui/toast";

export type PayKind = "revolut" | "phone";

const LABEL: Record<PayKind, string> = { revolut: "Revolut", phone: "BLIK" };
const BAD: Record<PayKind, string> = {
  revolut: "Не похоже на Revtag: латиница, цифры, точка, _ или -",
  phone: "Не похоже на номер телефона",
};

const shown = (me: Person, kind: PayKind) => (kind === "revolut" ? (me.revolut ? `@${me.revolut}` : "") : me.phone || "");

/**
 * The two rows. `editing` is the row open for editing (one at a time);
 * read-only phones see the values without the editors.
 */
export function PayRows({ me, editing, onEdit, firstRef, readOnly }: {
  me: Person;
  editing: PayKind | null;
  onEdit: (k: PayKind | null) => void;
  /** focused when the Revolut row opens from «Укажи Revolut или телефон» */
  firstRef?: RefObject<HTMLInputElement | null>;
  readOnly?: boolean;
}) {
  // A tapped row focuses its field within the tap (iOS shows the keyboard
  // only then); one opened together with the sheet leaves focus to <Sheet>.
  const tapped = useRef(false);
  return (
    <ul className="list pf-pay">
      {(["revolut", "phone"] as const).map((k) =>
        editing === k && !readOnly ? (
          <li key={k} className="pf-edit">
            <PayEdit
              me={me}
              kind={k}
              focus={tapped.current}
              inputRef={k === "revolut" ? firstRef : undefined}
              onDone={() => {
                tapped.current = false;
                onEdit(null);
              }}
            />
          </li>
        ) : (
          <li key={k}>
            {readOnly ? (
              <div className="prow">
                <span className="nm">{LABEL[k]}</span>
                <span className="cur">{shown(me, k) || "не указан"}</span>
              </div>
            ) : (
              <button
                className="prow"
                type="button"
                aria-label={`${LABEL[k]}: ${shown(me, k) || "не указан"}. Изменить`}
                onClick={() => {
                  tapped.current = true;
                  flushSync(() => onEdit(k));
                }}
              >
                <span className="nm">{LABEL[k]}</span>
                <span className={`cur pf-val${shown(me, k) ? " on" : ""}`}>{shown(me, k) || "указать"}</span>
                <ChevronIcon />
              </button>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

function PayEdit({ me, kind, focus, inputRef, onDone }: {
  me: Person;
  kind: PayKind;
  focus: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const [bad, setBad] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const rev = kind === "revolut";
  const id = rev ? "payRev" : "payTel";
  useLayoutEffect(() => {
    if (focus) ref.current?.focus(); // only when the row opens
  }, []);
  return (
    <form
      className="pay-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const raw = String(new FormData(e.currentTarget).get(kind) ?? "");
        const v = rev ? normRevtag(raw) : normPhone(raw);
        if (v === null) return setBad(true);
        const next = { revolut: me.revolut ?? "", phone: me.phone ?? "", [kind]: v };
        ref.current?.blur();
        if (setPayInfo(me.id, next)) toast(v ? "Сохранено — теперь тебе переведут в один тап" : "Убрано");
        onDone();
      }}
    >
      <label className="pay-lab" htmlFor={id}>
        {rev ? "Revolut — Revtag или ссылка revolut.me" : "Телефон для BLIK"}
      </label>
      <div className="join">
        <input
          ref={ref}
          className={rev ? "in" : "in num"}
          id={id}
          name={kind}
          defaultValue={shown(me, kind)}
          placeholder={rev ? "@revtag" : "+48 512 345 678"}
          maxLength={rev ? 80 : 24}
          {...(rev
            ? { autoCapitalize: "none", autoCorrect: "off", autoComplete: "off", spellCheck: false }
            : { type: "tel", inputMode: "tel" as const, autoComplete: "tel" })}
          enterKeyHint="done"
          aria-invalid={bad || undefined}
          aria-describedby={`${id}Hint`}
          onChange={() => bad && setBad(false)}
        />
        <button className="btn pri" type="submit">
          Сохранить
        </button>
      </div>
      <p className={`pay-hint${bad ? " bad" : ""}`} id={`${id}Hint`} aria-live="polite">
        {bad ? BAD[kind] : "Пустое поле — убрать"}
        {!bad && (
          <>
            {" · "}
            <button className="link pf-cancel" type="button" onClick={onDone}>
              отмена
            </button>
          </>
        )}
      </p>
    </form>
  );
}

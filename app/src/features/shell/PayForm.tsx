// «Как тебе переводить»: my Revtag and BLIK phone, so «Ты должен» on other
// phones can open the transfer in one tap. Pasted «@name» or a revolut.me
// link is fine; saved through the offline queue like a rename.
import { type RefObject, useState } from "react";
import { setPayInfo } from "../../lib/actions";
import { normPhone, normRevtag } from "../../lib/pay";
import type { Person } from "../../lib/types";
import { toast } from "../../ui/toast";

export function PayForm({ me, firstRef, onDone }: { me: Person; firstRef?: RefObject<HTMLInputElement | null>; onDone: () => void }) {
  const [err, setErr] = useState<"revolut" | "phone" | null>(null);
  return (
    <form
      className="pay-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const revolut = normRevtag(String(f.get("revolut") ?? ""));
        const phone = normPhone(String(f.get("phone") ?? ""));
        if (revolut === null) return setErr("revolut");
        if (phone === null) return setErr("phone");
        setErr(null);
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (setPayInfo(me.id, { revolut, phone })) toast(revolut || phone ? "Сохранено — теперь тебе переведут в один тап" : "Убрано");
        onDone();
      }}
    >
      <label className="pay-lab" htmlFor="payRev">
        Revolut — Revtag или ссылка revolut.me
      </label>
      <input
        ref={firstRef}
        className="in"
        id="payRev"
        name="revolut"
        defaultValue={me.revolut ? `@${me.revolut}` : ""}
        placeholder="@revtag"
        maxLength={80}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="next"
        aria-invalid={err === "revolut" || undefined}
        aria-describedby={err === "revolut" ? "payErr" : undefined}
        onChange={() => err === "revolut" && setErr(null)}
      />
      <label className="pay-lab" htmlFor="payTel">
        Телефон для BLIK
      </label>
      <input
        className="in num"
        id="payTel"
        name="phone"
        type="tel"
        inputMode="tel"
        defaultValue={me.phone ?? ""}
        placeholder="+48 512 345 678"
        maxLength={24}
        autoComplete="tel"
        enterKeyHint="done"
        aria-invalid={err === "phone" || undefined}
        aria-describedby={err === "phone" ? "payErr" : undefined}
        onChange={() => err === "phone" && setErr(null)}
      />
      <p className={`pay-hint${err ? " bad" : ""}`} id="payErr" aria-live="polite">
        {err === "revolut"
          ? "Не похоже на Revtag: латиница, цифры, точка, _ или -"
          : err === "phone"
            ? "Не похоже на номер телефона"
            : "Можно заполнить что-то одно. Видно всем, кто открывает эту страницу."}
      </p>
      <button className="btn pri pay-save" type="submit">
        Сохранить
      </button>
    </form>
  );
}

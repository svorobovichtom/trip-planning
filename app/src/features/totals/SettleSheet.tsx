// «Перевёл» / «Получил»: confirm a transfer and its amount (defaults to what's
// left; decimal comma ok). Saving closes the sheet at once — the balance
// moves optimistically and the toast says what was marked. With `prompt` it
// is the question after coming back from Revolut / the bank app
// («Отметить перевод → Юля 50,34?», «Да, перевёл» / «Ещё нет»).
import { type RefObject, useRef, useState } from "react";
import { fmtG, parseAmount } from "../../lib/money";
import { AmountInput } from "../../ui/AmountInput";
import { Morph } from "../../ui/Morph";
import { Sheet } from "../../ui/Sheet";
import { addSettlement, MAX_G } from "./api";
import { copyDec, fmtDec } from "./format";

export interface SettleAsk {
  from: string;
  to: string;
  /** what's left on this row, grosze */
  g: number;
  /** "out": I sent it (from = me); "in": I received it (to = me) */
  dir: "out" | "in";
  /** asked after returning from a transfer app (see usePayReturn) */
  prompt?: boolean;
  seq: number;
}

export function SettleSheet({ ask, onClose, name }: { ask: SettleAsk | null; onClose: () => void; name: (id: string) => string }) {
  // keep the last request on screen during the close animation
  const last = useRef<SettleAsk | null>(null);
  if (ask) last.current = ask;
  const a = ask ?? last.current;
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet
      open={!!ask}
      onOpenChange={(o) => !o && onClose()}
      title={a?.prompt ? `Отметить перевод → ${name(a.to)} ${fmtDec(a.g)}?` : "Отметить перевод"}
      initialFocus={inputRef}
      keyboard
    >
      {a && <SettleForm key={a.seq} a={a} name={name} inputRef={inputRef} onDone={onClose} />}
    </Sheet>
  );
}

function SettleForm({ a, name, inputRef, onDone }: {
  a: SettleAsk;
  name: (id: string) => string;
  inputRef: RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const [v, setV] = useState(() => copyDec(a.g));
  const pln = parseAmount(v);
  const g = Number.isFinite(pln) ? Math.round(pln * 100) : Number.NaN;
  const ok = Number.isInteger(g) && g >= 1 && g <= MAX_G;
  const other = a.dir === "out" ? name(a.to) : name(a.from);
  const hint = !v.trim()
    ? "Введи сумму"
    : !ok
      ? "Такая сумма не подойдёт"
      : g > a.g
        ? `Больше, чем осталось (${fmtG(a.g)}) — разница станет долгом в обратную сторону`
        : g < a.g
          ? `Останется ${fmtG(a.g - g)}`
          : "Долг будет закрыт полностью";
  return (
    <form
      className="st-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        inputRef.current?.blur();
        onDone();
        const done = a.dir === "out" ? `Отмечено: → ${other} ${fmtDec(g)}` : `Отмечено: ${other} → ${fmtDec(g)}`;
        void addSettlement(a.from, a.to, g, done);
      }}
    >
      <p className="st-pair">
        {a.dir === "out" ? (
          <>
            Ты <i>→</i> {other}
          </>
        ) : (
          <>
            {other} <i>→</i> тебе
          </>
        )}
      </p>
      <label className="st-lab" htmlFor="stAmt">
        {a.dir === "out" ? "Сколько перевёл" : "Сколько получил"}
      </label>
      <AmountInput
        ref={inputRef}
        className="ai-lg st-in"
        suffix="zł"
        id="stAmt"
        name="amount"
        enterKeyHint="done"
        value={v}
        onChange={setV}
        aria-describedby="stHint"
        aria-invalid={!ok || undefined}
      />
      <p className={`st-hint${ok ? "" : " bad"}`} id="stHint" aria-live="polite">
        <Morph>{hint}</Morph>
      </p>
      <div className="st-actions">
        <button className="btn" type="button" onClick={onDone}>
          {a.prompt ? "Ещё нет" : "Отмена"}
        </button>
        <button className="btn pri" type="submit" disabled={!ok}>
          {a.prompt ? "Да, перевёл" : a.dir === "out" ? "Перевёл" : "Получил"}
        </button>
      </div>
    </form>
  );
}

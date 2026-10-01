// The payment editor (new and edit). A photo or an amount is enough; with a
// readable photo the amount, title and category fill in after saving.
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { requireWriter } from "../../lib/actions";
import { compressImage, isPdf, MAX_BYTES, SCANNABLE_TYPE } from "../../lib/image";
import { byOrder, expenseCats, sortedCats, splitEven } from "../../lib/ledger";
import { fmtG, grosze } from "../../lib/money";
import { plural } from "../../lib/plural";
import { sessionStore, usePeople, useStore } from "../../lib/stores";
import { CATEGORIES, type Expense } from "../../lib/types";
import { Avatar } from "../../ui/Avatar";
import { confirmAction } from "../../ui/Confirm";
import { SheetBody, SheetFoot } from "../../ui/FullSheet";
import { Morph } from "../../ui/Morph";
import { toast } from "../../ui/toast";
import { claimsOf, deleteExpense, rescan, saveExpense } from "./api";
import { CameraIcon, CheckBox, GalleryIcon, Thumb, useNames, viewReceipt } from "./bits";
import { ClaimsPanel } from "./Lines";
import {
  amountsState, buildSave, claimsAvailable, claimsHint, cleanAmountInput, formAmountG, g2s, hasPhoto,
  initialForm, type Mode, type PayForm, readablePhoto, scanView, syncUntouched,
} from "./logic";
import { closePayment, hasDetails, openViewer, setPayView } from "./state";

const MODES: [Mode, string][] = [["equal", "Поровну"], ["amounts", "Суммами"], ["claims", "По чеку"]];

export function EditView({ x, initialFile, manual, amountRef }: {
  x: Expense | null;
  initialFile: File | null;
  manual: boolean;
  amountRef: RefObject<HTMLInputElement | null>;
}) {
  const people = usePeople();
  const order = useMemo(() => people.map((p) => p.id), [people]);
  const me = useStore(sessionStore, (s) => s.me);
  const name = useNames();
  const [f, setForm] = useState<PayForm>(() => initialForm(x, me, order));
  // The latest form, also between a change and the next render (save after
  // the photo finished compressing reads it right away).
  const fRef = useRef(f);
  const setF = (fn: (prev: PayForm) => PayForm) => {
    const next = fn(fRef.current);
    if (next === fRef.current) return;
    fRef.current = next;
    setForm(next);
  };
  const [preview, setPreview] = useState<{ url: string; pdf: boolean } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState(false);
  const pending = useRef<Promise<File | null> | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  // The scan finished / someone edited it: take their values for untouched fields.
  useEffect(() => {
    if (x) setF((prev) => syncUntouched(prev, x));
  }, [x]);
  // Revoke local previews.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  const set = (patch: Partial<PayForm>) => setF((prev) => ({ ...prev, ...patch }));
  const touch = (k: keyof PayForm["touched"]) => (prev: PayForm) => ({ ...prev, touched: { ...prev.touched, [k]: true } });

  const attach = async (raw: File) => {
    const n = x ? claimsOf(x.id).length : 0;
    if (n) {
      const ok = await confirmAction({
        title: "Заменить чек?",
        body: `По этому чеку уже есть отметки «кто что брал» (${n}). Новое фото их сбросит.`,
        ok: "Заменить",
        danger: true,
      });
      if (!ok) return;
    }
    setPreview({ url: URL.createObjectURL(raw), pdf: isPdf(raw.type) });
    setProcessing(true);
    const p = compressImage(raw).then((file) => {
      if (file.size > MAX_BYTES) {
        toast("Файл больше 10 МБ");
        return null;
      }
      return file;
    });
    pending.current = p;
    const file = await p;
    if (pending.current !== p) return; // replaced or removed meanwhile
    pending.current = null;
    setProcessing(false);
    if (!file) {
      setPreview(null);
      return;
    }
    if (file !== raw) setPreview({ url: URL.createObjectURL(file), pdf: false });
    setF((prev) => ({
      ...prev,
      file,
      removeFile: false,
      cat: prev.touched.cat ? prev.cat : "",
      mode: prev.mode === "claims" ? "equal" : prev.mode,
    }));
  };

  const started = useRef(false);
  useEffect(() => {
    if (initialFile && !started.current) {
      started.current = true;
      void attach(initialFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void attach(file);
  };
  const removePhoto = () => {
    pending.current = null;
    setProcessing(false);
    setPreview(null);
    set({ file: null, removeFile: !!x?.receipt });
  };

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving || !requireWriter()) return;
    setSaving(true);
    try {
      if (pending.current) await pending.current;
      const cur = fRef.current;
      const r = buildSave(cur, x, { order });
      if (!r.ok) {
        toast(r.error);
        if (r.field === "amount") amountRef.current?.focus();
        return;
      }
      if (x && !r.changed) {
        if (hasDetails(x)) setPayView("details");
        else closePayment();
        return;
      }
      const rec = await saveExpense(x, r.data, r.dropClaims);
      if (!rec) return;
      const g = grosze(rec.amount);
      const reading = rec.scan_status === "pending" || rec.scan_status === "running";
      toast(x ? (reading ? "Сохранено · читаю чек" : "Сохранено") : !g ? "Сохранено · читаю чек" : `Платёж добавлен · ${fmtG(g)}${reading ? " · читаю чек" : ""}`);
      if (x && hasDetails(rec)) setPayView("details");
      else closePayment();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!x) return;
    const g = grosze(x.amount);
    const ok = await confirmAction({
      title: "Удалить платёж?",
      body: `«${x.title || x.category || "Платёж"}»${g ? ` на ${fmtG(g)}` : ""} пропадёт у всех.`,
      ok: "Удалить",
      danger: true,
    });
    if (!ok) return;
    if (await deleteExpense(x)) {
      closePayment();
      toast("Платёж удалён");
    }
  };

  // ----- derived -----
  const photo = hasPhoto(f, x);
  const readable = readablePhoto(f, x) || (processing && !!preview && !preview.pdf);
  const hasLines = !!x && (x.lines ?? []).some((l) => l && l.text);
  const reading = !!x && (x.scan_status === "pending" || x.scan_status === "running");
  const part = byOrder(f.part, order);
  const A = formAmountG(f);
  const canClaims = claimsAvailable(f, x);
  const mode: Mode = f.mode === "claims" && !canClaims && x?.split_mode !== "claims" ? "equal" : f.mode;
  const st = mode === "amounts" ? amountsState(part, f.amts, A, readable) : null;
  const togglePart = (id: string) =>
    setF((prev) => ({ ...prev, part: prev.part.includes(id) ? prev.part.filter((p) => p !== id) : [...prev.part, id] }));

  return (
    <form className="fs-form" onSubmit={save} noValidate>
      <SheetBody>
        <input ref={gallery} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        <ReceiptBlock
          x={x}
          f={f}
          preview={preview}
          processing={processing}
          onPick={() => gallery.current?.click()}
          onCamera={() => camera.current?.click()}
          onRemove={removePhoto}
          onView={() => {
            if (preview) openViewer({ src: preview.url, pdf: preview.pdf, title: f.title.trim() || "Чек", meta: "ещё не сохранён" });
            else if (x) viewReceipt(x, name(x.paid_by));
          }}
        />

        <label className="amt">
          <input
            ref={amountRef}
            inputMode="decimal"
            placeholder="0,00"
            autoComplete="off"
            enterKeyHint="done"
            aria-label="Сумма"
            value={f.amount}
            onChange={(e) => {
              const v = cleanAmountInput(e.target.value);
              setF((prev) => touch("amount")({ ...prev, amount: v }));
            }}
          />
          <span>zł</span>
        </label>
        {!f.amount.trim() && readable && <p className="hint amt-hint">Можно не вводить — подставится из чека</p>}
        {!manual && !photo && !f.amount.trim() && <p className="hint amt-hint">Сумма или фото чека</p>}

        <input
          className="in"
          maxLength={120}
          placeholder={readable ? "Название — подставится из чека" : "Что купили — магазин, кафе…"}
          aria-label="Что купили"
          autoComplete="off"
          enterKeyHint="done"
          value={f.title}
          onChange={(e) => {
            const v = e.target.value;
            setF((prev) => touch("title")({ ...prev, title: v }));
          }}
        />

        <div className="fl" id="paidL">Платил</div>
        <div className="pills" role="group" aria-labelledby="paidL">
          {people.map((p) => (
            <button key={p.id} className="pill pill-av" type="button" aria-pressed={p.id === f.paid} onClick={() => set({ paid: p.id })}>
              <Avatar person={p} size={20} />
              {p.name}
              {p.id === me ? <span className="pill-me"> · я</span> : null}
            </button>
          ))}
        </div>

        <div className="fl" id="splitL">Делим</div>
        <div className="segc" role="group" aria-labelledby="splitL">
          {MODES.map(([m, label]) => {
            const off = m === "claims" && !canClaims && x?.split_mode !== "claims";
            return (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                aria-disabled={off || undefined}
                className={off ? "off" : undefined}
                onClick={() => {
                  if (off) setHint((h) => !h);
                  else {
                    setHint(false);
                    set({ mode: m });
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {hint && mode !== "claims" && <p className="hint mode-hint">{claimsHint(f, x)}</p>}

        {mode === "equal" && (
          <EqualPanel people={people} part={part} total={A || (x && !f.touched.amount ? grosze(x.amount) : 0)} photo={readable} onToggle={togglePart} all={() => set({ part: [...order] })} />
        )}
        {mode === "amounts" && st && (
          <AmountsPanel
            people={people}
            f={f}
            st={st}
            photo={readable}
            onToggle={togglePart}
            onAmount={(id, v) => setF((prev) => ({ ...prev, amts: { ...prev.amts, [id]: cleanAmountInput(v) } }))}
          />
        )}
        {mode === "claims" && x && (canClaims ? <ClaimsPanel x={x} compact /> : <p className="hint mode-hint">{claimsHint(f, x)}</p>)}

        {/* A receipt is split into categories by its lines; one category for the
            whole payment is only for payments without a receipt (fuel, rent…). */}
        {hasLines && x ? (
          <>
            <div className="fl">Категории из чека</div>
            <ul className="cat-break">
              {sortedCats(expenseCats(x)).map(([c, g]) => (
                <li key={c}>
                  <span>{c}</span>
                  <span className="num">{fmtG(g)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="fl" id="catL">
              {readable ? "Категории" : "Категория"}
            </div>
            {readable && (
              <div className="cat-scan">
                <p className="hint">
                  {reading
                    ? "Читаю чек — позиции разложатся по категориям сами."
                    : x
                      ? "Позиции чека разложатся по категориям сами."
                      : "После сохранения позиции чека разложатся по категориям сами."}
                </p>
                {x && !reading && x.receipt && (
                  <button className="btn" type="button" onClick={() => void rescan(x)}>
                    Разложить по категориям
                  </button>
                )}
                <p className="hint">Или одна категория на весь платёж:</p>
              </div>
            )}
            <div className="pills pills-x" role="group" aria-labelledby="catL">
              {[...CATEGORIES.map((c) => [c, c]), ...(f.cat && !(CATEGORIES as readonly string[]).includes(f.cat) ? [[f.cat, f.cat]] : [])].map(([v, t]) => (
                <button
                  key={v}
                  className="pill"
                  type="button"
                  aria-pressed={v === f.cat}
                  onClick={() => setF((prev) => touch("cat")({ ...prev, cat: prev.cat === v ? "" : v! }))}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        <label className="fl" htmlFor="payDate">
          Дата
        </label>
        <input id="payDate" className="in" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
      </SheetBody>
      <SheetFoot>
        {x && (
          <button className="link bad" type="button" onClick={() => void remove()}>
            Удалить
          </button>
        )}
        <span className="fs-sp" />
        <button className="btn pri save" type="submit" disabled={saving || (mode === "amounts" && !!st?.err)}>
          {saving ? (f.file ? "Загружаю…" : "Сохраняю…") : "Сохранить"}
        </button>
      </SheetFoot>
    </form>
  );
}

// ---------- receipt block ----------

function ReceiptBlock({ x, f, preview, processing, onPick, onCamera, onRemove, onView }: {
  x: Expense | null;
  f: PayForm;
  preview: { url: string; pdf: boolean } | null;
  processing: boolean;
  onPick: () => void;
  onCamera: () => void;
  onRemove: () => void;
  onView: () => void;
}) {
  const saved = !!x?.receipt && !f.removeFile && !f.file && !preview;
  if (!preview && !saved) {
    return (
      <div className="pick">
        <button className="btn" type="button" onClick={onPick}>
          <GalleryIcon />
          <span>Фото чека</span>
        </button>
        <button className="btn pick-cam" type="button" aria-label="Сфотографировать" onClick={onCamera}>
          <CameraIcon />
        </button>
      </div>
    );
  }
  let s = "";
  let m = "";
  let busy = false;
  let action: { label: string; run: () => void } | null = null;
  if (preview) {
    s = preview.pdf ? "PDF чека" : "Фото чека";
    if (processing) m = "готовлю фото…";
    else if (f.file && SCANNABLE_TYPE.test(f.file.type)) m = "прочитаем после сохранения — можно сразу сохранить";
    else m = preview.pdf ? "PDF приложим, но не распознаем — введи сумму" : "этот формат не читаю — введи сумму";
  } else if (x) {
    const sv = scanView(x);
    switch (sv.kind) {
      case "scanning":
        s = "Читаю чек…";
        m = "обычно минута-две, можно закрыть";
        busy = true;
        break;
      case "failed":
        s = "Не распознали";
        m = sv.retry ? "можно повторить или ввести сумму" : "этот формат не читаю — введи сумму";
        if (sv.retry) action = { label: "Повторить", run: () => void rescan(x) };
        break;
      case "mismatch":
      case "ok": {
        const n = (x.lines ?? []).filter((l) => l && l.text).length;
        s = `Прочитали ${n} ${plural(n, "позицию", "позиции", "позиций")}`;
        m = sv.kind === "mismatch" ? "позиции неточные — не сходятся с суммой" : "";
        break;
      }
      case "unread":
        s = "Чек приложен";
        m = "ещё не распознан";
        action = { label: "Распознать чек", run: () => void rescan(x) };
        break;
      default:
        s = "Чек приложен";
        m = /\.pdf$/i.test(x.receipt ?? "") ? "PDF не распознаём" : "";
    }
  }
  return (
    <div className="rc">
      <Thumb x={x ?? undefined} src={preview ? (preview.pdf ? null : preview.url) : undefined} pdf={preview?.pdf} scanning={busy || processing} onOpen={onView} />
      <div className="rc-t">
        <span className={`rc-s${busy ? " shim" : ""}`}>
          <Morph>{s}</Morph>
        </span>
        {m && <span className="rc-m">{m}</span>}
        <span className="rc-a">
          {action && (
            <button className="rt" type="button" onClick={action.run}>
              {action.label}
            </button>
          )}
          <button className="rt" type="button" onClick={onPick}>
            Заменить
          </button>
          <button className="rt" type="button" onClick={onRemove}>
            Убрать
          </button>
        </span>
      </div>
    </div>
  );
}

// ---------- split panels ----------

type P = { id: string; name: string };

function EqualPanel({ people, part, total, photo, onToggle, all }: {
  people: readonly P[];
  part: string[];
  total: number;
  photo: boolean;
  onToggle: (id: string) => void;
  all: () => void;
}) {
  const shares = new Map<string, number>();
  splitEven(total, part, shares);
  const n = part.length;
  let sum = n ? `${n === people.length ? "На всех" : `На ${n} из ${people.length}`} · ` : "Отметь, на кого делим";
  if (n) sum += total ? `по ${fmtG(Math.floor(total / n))}` : photo ? "сумма подставится из чека" : "впиши сумму";
  return (
    <div className="mode">
      <ul className="list chks">
        {people.map((p) => {
          const on = part.includes(p.id);
          return (
            <li key={p.id}>
              <button className="chk" type="button" aria-pressed={on} onClick={() => onToggle(p.id)}>
                <CheckBox />
                <span className="nm">{p.name}</span>
                <span className="sh">{on && total ? fmtG(shares.get(p.id) ?? 0) : ""}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="msum">
        <Morph>{sum}</Morph>
        {n > 0 && n < people.length && (
          <button className="link msum-a" type="button" onClick={all}>
            На всех
          </button>
        )}
      </div>
    </div>
  );
}

function AmountsPanel({ people, f, st, photo, onToggle, onAmount }: {
  people: readonly P[];
  f: PayForm;
  st: ReturnType<typeof amountsState>;
  photo: boolean;
  onToggle: (id: string) => void;
  onAmount: (id: string, v: string) => void;
}) {
  const head = st.total
    ? `Расписано ${fmtG(st.fixed)} из ${fmtG(st.total)} · остаток ${fmtG(st.rem)}`
    : `Расписано ${fmtG(st.fixed)}${st.autos.length ? ` · остальное поровну на ${st.autos.length} «авто»` : ""}`;
  return (
    <div className="mode">
      <ul className="list chks">
        {people.map((p) => {
          const on = st.ids.includes(p.id);
          const v = on ? (f.amts[p.id] ?? "") : "";
          const auto = on && !v.trim();
          const ag = st.auto.get(p.id) ?? 0;
          return (
            <li key={p.id} className="amr">
              <button className="chk" type="button" aria-pressed={on} onClick={() => onToggle(p.id)}>
                <CheckBox />
                <span className="nm">{p.name}</span>
              </button>
              <input
                className={`in am-in${st.bad.includes(p.id) ? " bad" : ""}`}
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                aria-label={`Сумма: ${p.name}`}
                disabled={!on}
                value={v}
                placeholder={!on ? "" : st.total ? g2s(ag) : photo ? "из чека" : "0,00"}
                onChange={(e) => onAmount(p.id, e.target.value)}
              />
              <button
                className="pill am-auto"
                type="button"
                disabled={!on}
                aria-pressed={auto}
                aria-label={`Авто: ${p.name}`}
                onClick={() => onAmount(p.id, auto ? (ag ? g2s(ag) : "") : "")}
              >
                авто
              </button>
            </li>
          );
        })}
      </ul>
      <div className="msum">
        <Morph>{head}</Morph>
        {st.total > 0 && st.rem > 0 && st.autos.length > 0 && <span className="msum-n"> — поровну на {st.autos.length} «авто»</span>}
        {st.err && <span className="err">{st.err}</span>}
      </div>
    </div>
  );
}

// Money field whose characters arrive one by one as they are typed: each new
// character rises out of a blur, a paste or a scanned amount staggers in, the
// caret slides after the last character, and a complete amount (two decimals)
// settles with a small bounce. The real <input> stays on top for the keyboard,
// IME, paste, autofill and screen readers, with its text and caret
// transparent; the formatted value is drawn underneath. Append-style: the
// caret always sits at the end (a tap anywhere on the field focuses it there).
import { type ComponentProps, type CSSProperties, type ReactNode, type Ref, useCallback, useLayoutEffect, useRef, useState } from "react";
import "./amount.css";

/** narrow no-break space between thousands groups */
const GROUP = "\u202f";
/** delay between characters that arrive together (paste, scan) */
const STAGGER_MS = 28;
const SETTLE: Keyframe[] = [{ transform: "scale(1)" }, { transform: "scale(1.02)", offset: 0.18 }, { transform: "scale(1)" }];

/** What the field shows for a typed value: "1234.5" -> "1 234,5", spaces dropped, "." -> ",". */
export function displayAmount(raw: string): string {
  const t = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/\./g, ",");
  const i = t.indexOf(",");
  const int = i < 0 ? t : t.slice(0, i);
  const rest = i < 0 ? "" : t.slice(i);
  if (!/^\d{4,}$/.test(int)) return t;
  return int.replace(/\B(?=(\d{3})+$)/g, GROUP) + rest;
}

type InputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "ref" | "children" | "className" | "placeholder">;

export function AmountInput({
  value,
  onChange,
  placeholder = "0,00",
  suffix,
  align = "start",
  className,
  ref,
  disabled,
  onFocus,
  onBlur,
  onSelect,
  ...rest
}: InputProps & {
  value: string;
  /** the raw text, as typed */
  onChange: (value: string) => void;
  placeholder?: string;
  /** drawn right after the value («zł») */
  suffix?: ReactNode;
  align?: "start" | "end";
  className?: string;
  ref?: Ref<HTMLInputElement>;
}) {
  const own = useRef<HTMLInputElement | null>(null);
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as { current: HTMLInputElement | null }).current = el;
    },
    [ref],
  );
  const [focus, setFocus] = useState(false);
  const [range, setRange] = useState(false);

  const shown = displayAmount(value);
  const empty = !shown;

  // Characters are keyed by position and character, with group spaces drawn
  // as a margin rather than as characters: typing at the end mounts only the
  // new ones, and those play the arrival animation. Nothing animates on the
  // first render (an existing amount just shows).
  const flat = shown.replaceAll(GROUP, "");
  const prev = useRef<string | null>(null);
  const before = prev.current;
  let firstNew = flat.length;
  if (before != null && before !== flat) {
    firstNew = 0;
    while (firstNew < flat.length && flat[firstNew] === before[firstNew]) firstNew++;
  }
  const groupAt = new Set<number>();
  for (let i = 0, k = 0; i < shown.length; i++) {
    if (shown[i] === GROUP) groupAt.add(k);
    else k++;
  }

  const chars = useRef<HTMLSpanElement | null>(null);
  const caret = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = flat;
    const c = chars.current;
    if (!c) return;
    const k = caret.current;
    if (k) {
      k.style.setProperty("--x", `${empty ? c.offsetLeft : c.offsetLeft + c.offsetWidth}px`);
      // solid while typing, blinks again when idle: restart the blink
      if (was != null && was !== flat) {
        k.style.animation = "none";
        void k.offsetWidth;
        k.style.animation = "";
      }
    }
    const done = (s: string) => /,\d{2}$/.test(s);
    if (was != null && done(flat) && !done(was) && !matchMedia("(prefers-reduced-motion: reduce)").matches)
      c.animate(SETTLE, { duration: 600, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  });

  // Collapsed selection anywhere but the end -> the end. A real range
  // (select all, to replace) is left alone and drawn as a highlight.
  const toEnd = (el: HTMLInputElement) => {
    const n = el.value.length;
    const s = el.selectionStart ?? n;
    const e = el.selectionEnd ?? n;
    setRange(s !== e);
    if (s === e && s !== n) el.setSelectionRange(n, n);
  };

  return (
    <div
      className={`ai${className ? ` ${className}` : ""}`}
      data-align={align}
      data-empty={empty || undefined}
      data-focus={focus || undefined}
      data-range={(focus && range && !empty) || undefined}
      data-disabled={disabled || undefined}
    >
      <span className="ai-view" aria-hidden="true">
        <span className="ai-v" ref={chars}>
          {empty ? (
            <span className="ai-ph">{placeholder}</span>
          ) : (
            [...flat].map((ch, i) => (
              <span
                key={`${i}${ch}`}
                className={`ai-ch${groupAt.has(i) ? " ai-g" : ""}${i >= firstNew ? " ai-new" : ""}`}
                style={i > firstNew ? ({ "--delay": `${(i - firstNew) * STAGGER_MS}ms` } as CSSProperties) : undefined}
              >
                {ch}
              </span>
            ))
          )}
        </span>
        <i className="ai-caret" ref={caret} />
        {suffix != null && <span className="ai-sx">{suffix}</span>}
      </span>
      <input
        {...rest}
        ref={setRef}
        className="ai-in"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          toEnd(e.target);
        }}
        onFocus={(e) => {
          setFocus(true);
          const el = e.currentTarget;
          // after the browser placed the caret where the finger was
          requestAnimationFrame(() => document.activeElement === el && toEnd(el));
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          setRange(false);
          onBlur?.(e);
        }}
        onSelect={(e) => {
          toEnd(e.currentTarget);
          onSelect?.(e);
        }}
      />
    </div>
  );
}

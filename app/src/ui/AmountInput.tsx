// Money field whose digits morph as they are typed (torph). The real <input>
// stays on top for the keyboard, IME, paste, autofill and screen readers, with
// its text and caret transparent; the formatted value is drawn underneath by
// <TextMorph> with a fake caret after the last character. Append-style: the
// caret always sits at the end (a tap anywhere on the field focuses it there).
// Empty: the placeholder is drawn in the same morph, so the first digit rolls
// out of «0,00» instead of replacing it.
import { type ComponentProps, type ReactNode, type Ref, useCallback, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import "./amount.css";

/** narrow no-break space: torph keeps "1 234,5" as one number (digits roll by place) */
const GROUP = " ";

/** What the field shows for a typed value: "1234.5" -> "1 234,5", spaces dropped, "." -> ",". */
export function displayAmount(raw: string): string {
  const t = raw.replace(/[\s  ]/g, "").replace(/\./g, ",");
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
  const text = empty ? placeholder : shown;

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
        <TextMorph
          className="ai-v"
          locale="ru"
          duration={340}
          ease="cubic-bezier(0.19, 1, 0.22, 1)"
          cursorIndex={empty ? undefined : text.length}
        >
          {text}
        </TextMorph>
        {/* remounted on every change: solid while typing, blinks when idle */}
        <i className="ai-caret" key={shown} />
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

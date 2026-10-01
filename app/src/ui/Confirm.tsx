import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef } from "react";
import { createStore, useStore } from "../lib/stores";
import "./confirm.css";

interface Ask {
  title: string;
  body?: string;
  /** read-only text shown selected, to copy by hand (clipboard fallback) */
  text?: string;
  ok: string;
  /** null hides the cancel button */
  cancel?: string | null;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const store = createStore<Ask | null>(null);

/** Promise-based confirm (Base UI AlertDialog). Needs <ConfirmHost/> mounted once. */
export function confirmAction(opts: Omit<Ask, "resolve">): Promise<boolean> {
  store.get()?.resolve(false);
  return new Promise((resolve) => store.set({ ...opts, resolve }));
}

/** Clipboard fallback: shows `text` selected in a dialog, to copy by hand. */
export function showCopy(title: string, text: string): Promise<boolean> {
  return confirmAction({ title, text, ok: "Готово", cancel: null });
}

export function ConfirmHost() {
  const live = useStore(store, (s) => s);
  // Keep the last question on screen while the dialog fades out.
  const last = useRef(live);
  if (live) last.current = live;
  const ask = live ?? last.current;
  const textRef = useRef<HTMLInputElement>(null);
  const done = (ok: boolean) => {
    const a = store.get();
    store.set(null);
    a?.resolve(ok);
  };
  return (
    <AlertDialog.Root open={!!live} onOpenChange={(o) => !o && done(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="cf-backdrop" />
        <AlertDialog.Popup className="cf-popup" initialFocus={ask?.text != null ? textRef : undefined}>
          <AlertDialog.Title className="cf-title">{ask?.title}</AlertDialog.Title>
          {ask?.body && <AlertDialog.Description className="cf-body">{ask.body}</AlertDialog.Description>}
          {ask?.text != null && (
            <input
              className="in cf-text"
              readOnly
              value={ask.text}
              aria-label={ask.title}
              onFocus={(e) => e.currentTarget.select()}
              ref={textRef}
            />
          )}
          <div className="cf-actions">
            {ask?.cancel !== null && <AlertDialog.Close className="btn">{ask?.cancel ?? "Отмена"}</AlertDialog.Close>}
            <button className={ask?.danger ? "btn cf-danger" : "btn pri"} type="button" onClick={() => done(true)}>
              {ask?.ok}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

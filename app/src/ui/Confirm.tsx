import { AlertDialog } from "@base-ui/react/alert-dialog";
import { createStore, useStore } from "../lib/stores";
import "./confirm.css";

interface Ask {
  title: string;
  body?: string;
  ok: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const store = createStore<Ask | null>(null);

/** Promise-based confirm (Base UI AlertDialog). Needs <ConfirmHost/> mounted once. */
export function confirmAction(opts: Omit<Ask, "resolve">): Promise<boolean> {
  store.get()?.resolve(false);
  return new Promise((resolve) => store.set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const ask = useStore(store, (s) => s);
  const done = (ok: boolean) => {
    const a = store.get();
    store.set(null);
    a?.resolve(ok);
  };
  return (
    <AlertDialog.Root open={!!ask} onOpenChange={(o) => !o && done(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="cf-backdrop" />
        <AlertDialog.Popup className="cf-popup">
          <AlertDialog.Title className="cf-title">{ask?.title}</AlertDialog.Title>
          {ask?.body && <AlertDialog.Description className="cf-body">{ask.body}</AlertDialog.Description>}
          <div className="cf-actions">
            <AlertDialog.Close className="btn">Отмена</AlertDialog.Close>
            <button className={ask?.danger ? "btn cf-danger" : "btn pri"} type="button" onClick={() => done(true)}>
              {ask?.ok}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

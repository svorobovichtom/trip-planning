// One full-height sheet for a payment: the editor (new / edit) or the
// details (receipt lines, claims). Content is keyed by the open session so
// every open starts fresh; the last record is kept for the close animation.
import { useEffect, useRef } from "react";
import { useData } from "../../lib/stores";
import type { Expense } from "../../lib/types";
import { FullSheet } from "../../ui/FullSheet";
import { toast } from "../../ui/toast";
import { DetailsView } from "./DetailsView";
import { EditView } from "./EditView";
import { closePayment, payUi, usePayUi } from "./state";

export function PaymentSheet() {
  const open = usePayUi((s) => s.open);
  const id = usePayUi((s) => s.id);
  const view = usePayUi((s) => s.view);
  const seq = usePayUi((s) => s.seq);
  const file = usePayUi((s) => s.file);
  const manual = usePayUi((s) => s.manual);
  const live = useData((s) => (id ? s.expenses.get(id) : undefined));
  const last = useRef<Expense | undefined>(undefined);
  if (live) last.current = live;
  const x = id ? (live ?? last.current ?? null) : null;

  // Deleted elsewhere while open here.
  const had = useRef(false);
  useEffect(() => {
    if (!open || !id) {
      had.current = false;
      return;
    }
    if (live) had.current = true;
    else if (had.current) {
      had.current = false;
      closePayment();
      toast("Этот платёж удалили");
    }
  }, [open, id, live]);

  const amountRef = useRef<HTMLInputElement>(null);
  const title = !id ? "Новый платёж" : view === "edit" ? "Изменить платёж" : "Платёж";

  return (
    <FullSheet
      open={open}
      onOpenChange={(o) => !o && closePayment()}
      onClosed={() => {
        if (!payUi.get().open) last.current = undefined;
      }}
      title={title}
      initialFocus={manual ? amountRef : undefined}
      focusAlways={manual}
    >
      {id && !x ? null : view === "details" && x ? (
        <DetailsView key={`d${seq}`} x={x} />
      ) : (
        <EditView key={`e${seq}`} x={x} initialFile={file} manual={manual} amountRef={amountRef} />
      )}
    </FullSheet>
  );
}

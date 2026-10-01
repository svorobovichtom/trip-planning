// «Расходы»: add a payment (receipt from the gallery, camera, or by hand)
// and the list of payments, newest first. A photo alone is enough: the
// server reads it in the background and fills the amount, title and lines.
import { memo, useRef } from "react";
import { requireWriter } from "../../lib/actions";
import { useSortedExpenses } from "../../lib/hooks";
import { fmtG, grosze } from "../../lib/money";
import { canWriteKey } from "../../lib/pb";
import { useData, usePeople } from "../../lib/stores";
import type { Expense } from "../../lib/types";
import { lazyPart, PartBoundary } from "../../ui/lazy";
import { Morph } from "../../ui/Morph";
import { rescan } from "./api";
import { CameraIcon, expenseName, fmtDay, GalleryIcon, Thumb, useNames, viewReceipt } from "./bits";
import { isScanning, parseDate, scanView, splitLabel } from "./logic";
import { openNewPayment, openPayment } from "./state";
import "./payments.css";

// The editor/details sheet and the receipt viewer are separate chunks: they
// load right after this tab mounts (itself after the first idle), not with the list.
const PaymentSheet = lazyPart(() => import("./PaymentSheet"), (m) => m.PaymentSheet);
const ReceiptViewer = lazyPart(() => import("./ReceiptViewer"), (m) => m.ReceiptViewer);

export function PaymentsPage() {
  const loaded = useData((s) => s.loaded);
  const xs = useSortedExpenses();
  const people = usePeople();
  const order = people.map((p) => p.id).join(",");
  const name = useNames();
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const pick = (input: HTMLInputElement | null) => {
    if (!input || !requireWriter()) return;
    input.click();
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) openNewPayment({ file: f });
  };

  return (
    <>
      {!canWriteKey && <div className="ro">Только просмотр. Чтобы добавлять чеки, попроси ссылку с ключом.</div>}
      {canWriteKey && (
        <div className="pay-add">
          <button className="btn pri pay-main" type="button" onClick={() => pick(gallery.current)}>
            <GalleryIcon />
            <span>Чек из галереи</span>
          </button>
          <div className="pay-row">
            <button className="btn pay-cam" type="button" onClick={() => pick(camera.current)}>
              <CameraIcon />
              <span>Сфотографировать</span>
            </button>
            <button
              className="link pay-hand"
              type="button"
              onClick={() => requireWriter() && openNewPayment({ manual: true })}
            >
              Ввести вручную
            </button>
          </div>
          <input ref={gallery} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
        </div>
      )}
      <div className="h2row">
        <h2>Платежи</h2>
      </div>
      {!loaded ? (
        <div className="skel" aria-busy="true" aria-label="Загружаю платежи" />
      ) : (
        <ul className="list exps">
          {!xs.length && (
            <li className="empty-s">
              Платежей пока нет.{canWriteKey ? " Добавь фото чека — сумма, магазин и позиции подставятся сами." : ""}
            </li>
          )}
          {xs.map((x) => (
            <ExpenseRow key={x.id} x={x} payer={name(x.paid_by)} order={order} />
          ))}
        </ul>
      )}
      <PartBoundary quiet>
        <PaymentSheet />
      </PartBoundary>
      <PartBoundary quiet>
        <ReceiptViewer />
      </PartBoundary>
    </>
  );
}

const ExpenseRow = memo(function ExpenseRow({ x, payer, order }: { x: Expense; payer: string; order: string }) {
  const g = grosze(x.amount);
  const sv = scanView(x);
  const when = parseDate(x.spent_at || x.created);
  const meta = [`платил ${payer}`, splitLabel(x, order ? order.split(",") : []), when ? fmtDay.format(when) : ""].filter(Boolean).join(" · ");
  return (
    <li className="xrow">
      <button className="xhit" type="button" aria-label={`Открыть: ${expenseName(x)}`} onClick={() => openPayment(x.id)} />
      <Thumb x={x} scanning={isScanning(x)} onOpen={() => viewReceipt(x, payer)} />
      <span className="xt">
        <span className="name">{expenseName(x)}</span>
        <span className="pl">{meta}</span>
        {sv.kind === "scanning" && <span className="st shim">читаю чек…</span>}
        {sv.kind === "failed" && (
          <span className="st">
            не распознали
            {sv.retry && canWriteKey && (
              <>
                {" · "}
                <button className="rt" type="button" onClick={() => void rescan(x)}>
                  повторить
                </button>
              </>
            )}
          </span>
        )}
        {sv.kind === "mismatch" && <span className="st">позиции неточные</span>}
      </span>
      <span className={`xamt${g ? "" : " q"}`}>
        <Morph>{g ? fmtG(g) : isScanning(x) ? "…" : "—"}</Morph>
      </span>
    </li>
  );
});

// PLACEHOLDER (phase 1): read-only list of payments. The payments agent
// replaces this with the full flow from web/index.html (new payment sheet,
// receipt photo + background scan status, split modes, claims).
import { useSortedExpenses, useTotalG } from "../../lib/hooks";
import { fmtG, grosze } from "../../lib/money";
import { canWriteKey } from "../../lib/pb";
import { usePeople } from "../../lib/stores";
import "./payments.css";

const fmtDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const parseDate = (s?: string) => (s ? new Date(String(s).replace(" ", "T")) : null);

export function PaymentsPage() {
  const xs = useSortedExpenses();
  const people = usePeople();
  const total = useTotalG();
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  return (
    <>
      {!canWriteKey && <div className="ro">Только просмотр. Чтобы добавлять чеки, попроси ссылку с ключом.</div>}
      <div className="h2row">
        <h2>Платежи</h2>
        <span className="sec-n">{xs.length ? `${xs.length} · ${fmtG(total)}` : ""}</span>
      </div>
      <ul className="list exps">
        {!xs.length && <li className="empty-s">Чеков пока нет.</li>}
        {xs.map((x) => {
          const when = parseDate(x.spent_at || x.created);
          const g = grosze(x.amount);
          const scanning = x.scan_status === "pending" || x.scan_status === "running";
          const meta = [
            x.title ? x.category : "",
            `платил ${name(x.paid_by)}`,
            when && !Number.isNaN(when.getTime()) ? fmtDay.format(when) : "",
          ].filter(Boolean);
          return (
            <li key={x.id}>
              <div className="xt">
                <span className="name">{x.title || x.category || "Платёж"}</span>
                <span className="pl">{meta.join(" · ")}</span>
              </div>
              <span className={`xamt${g ? "" : " q"}`}>{g ? fmtG(g) : scanning ? "читаю чек…" : "—"}</span>
            </li>
          );
        })}
      </ul>
      <p className="note">Добавить и изменить платежи пока можно на основной странице.</p>
    </>
  );
}

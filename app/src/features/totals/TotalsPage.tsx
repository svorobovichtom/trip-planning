// PLACEHOLDER (phase 1): read-only totals from the tested ledger
// (lib/ledger.ts). The totals agent replaces this with the full design from
// web/index.html (hero, «Кто кому переводит», categories, people, CSV).
import { useLedger } from "../../lib/hooks";
import { settle } from "../../lib/ledger";
import { fmtG, fmtSigned } from "../../lib/money";
import { useExpenses, usePeople } from "../../lib/stores";
import "./totals.css";

export function TotalsPage() {
  const L = useLedger();
  const people = usePeople();
  const n = useExpenses().size;
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "?";
  if (!n) {
    return (
      <>
        <div className="hero">
          <div className="k">Всего потрачено</div>
          <div className="v">{fmtG(0)}</div>
        </div>
        <p className="note">Чеков пока нет.</p>
      </>
    );
  }
  const tx = settle(L.bal);
  return (
    <>
      <div className="hero">
        <div className="k">Всего потрачено</div>
        <div className="v">{fmtG(L.total)}</div>
      </div>
      <div className="h2row">
        <h2>Кто кому переводит</h2>
      </div>
      <ul className="list kv">
        {!tx.length && (
          <li>
            <span className="l">Все в расчёте</span>
          </li>
        )}
        {tx.map((t) => (
          <li key={`${t.from}>${t.to}`}>
            <span className="l">
              {name(t.from)}
              <i>→</i>
              {name(t.to)}
            </span>
            <span className="r">{fmtG(t.g)}</span>
          </li>
        ))}
      </ul>
      <div className="h2row">
        <h2>По людям</h2>
      </div>
      <ul className="list kv">
        {people.map((p) => (
          <li key={p.id}>
            <span className="l">
              {p.name}
              <span className="s">
                заплатил {fmtG(L.paid.get(p.id) ?? 0)} · доля {fmtG(L.owes.get(p.id) ?? 0)}
              </span>
            </span>
            <span className="r">{L.bal.get(p.id) ? fmtSigned(L.bal.get(p.id)!) : "0"}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

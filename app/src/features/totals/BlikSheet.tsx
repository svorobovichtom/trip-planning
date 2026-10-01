// «BLIK»: there is no link that opens a bank app with a phone transfer
// filled in, so the sheet gives the two things to paste — the phone and the
// amount ("50,34") — for «Przelew na telefon» in the bank's app.
import { useRef } from "react";
import { phoneForCopy } from "../../lib/pay";
import { Sheet } from "../../ui/Sheet";
import { copyText } from "./copy";
import { copyDec, fmtDec } from "./format";

export interface BlikAsk {
  to: string;
  phone: string;
  /** grosze */
  g: number;
  seq: number;
}

export function BlikSheet({ ask, onClose, name }: { ask: BlikAsk | null; onClose: () => void; name: (id: string) => string }) {
  const last = useRef<BlikAsk | null>(null);
  if (ask) last.current = ask;
  const a = ask ?? last.current;
  return (
    <Sheet open={!!ask} onOpenChange={(o) => !o && onClose()} title="Перевод по BLIK">
      {a && (
        <>
          <ul className="list bk-list">
            <li>
              <span className="bk-k">Телефон · {name(a.to)}</span>
              <span className="bk-v num">{a.phone}</span>
              <button className="t-copy" type="button" aria-label={`Скопировать телефон ${a.phone}`} onClick={() => void copyText(phoneForCopy(a.phone))}>
                Скопировать
              </button>
            </li>
            <li>
              <span className="bk-k">Сумма, zł</span>
              <span className="bk-v num">{fmtDec(a.g)}</span>
              <button className="t-copy" type="button" aria-label={`Скопировать сумму ${copyDec(a.g)}`} onClick={() => void copyText(copyDec(a.g))}>
                Скопировать
              </button>
            </li>
          </ul>
          <p className="note">Перевод на телефон в приложении банка</p>
        </>
      )}
    </Sheet>
  );
}

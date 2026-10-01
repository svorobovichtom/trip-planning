import { useLedger } from "../../lib/hooks";
import { fmtG } from "../../lib/money";
import { useExpenses, useMe } from "../../lib/stores";

/** Header line on «Итоги»: the selected person's balance. */
export function useTotalsSummary(): string {
  const n = useExpenses().size;
  const me = useMe();
  const L = useLedger();
  if (!n) return "чеков пока нет";
  if (!me) return "Выбери себя";
  const b = L.bal.get(me.id) ?? 0;
  return b > 0 ? `Ты получишь ${fmtG(b)}` : b < 0 ? `Ты должен ${fmtG(-b)}` : "Ты в расчёте";
}

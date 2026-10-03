import { useLedger } from "../../lib/hooks";
import { fmtG } from "../../lib/money";
import { useExpenses, useMe } from "../../lib/stores";

/** Header line on «Итоги»: the selected person's balance (their group's, when they settle together). */
export function useTotalsSummary(): string {
  const n = useExpenses().size;
  const me = useMe();
  const L = useLedger();
  if (!n) return "чеков пока нет";
  if (!me) return "Выбери себя";
  // in a group: the group's balance (what is actually transferred)
  const head = L.head.get(me.id) ?? me.id;
  const b = L.gbal.get(head) ?? 0;
  if ((L.members.get(head)?.length ?? 1) > 1) return b > 0 ? `Вы получите ${fmtG(b)}` : b < 0 ? `Вы должны ${fmtG(-b)}` : "Вы в расчёте";
  return b > 0 ? `Ты получишь ${fmtG(b)}` : b < 0 ? `Ты должен ${fmtG(-b)}` : "Ты в расчёте";
}

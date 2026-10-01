import { useLedger } from "../../lib/hooks";
import { fmtG } from "../../lib/money";
import { plural } from "../../lib/plural";
import { useExpenses, useMe, usePeople } from "../../lib/stores";

/** Header line on «Итоги»: my balance, or the total. */
export function useTotalsSummary(): string {
  const n = useExpenses().size;
  const people = usePeople();
  const me = useMe();
  const L = useLedger();
  if (!n) return "чеков пока нет";
  if (!me) return `${fmtG(L.total)} на ${people.length} ${plural(people.length, "человека", "человек", "человек")}`;
  const b = L.bal.get(me.id) ?? 0;
  return b > 0 ? `Ты получишь ${fmtG(b)}` : b < 0 ? `Ты должен ${fmtG(-b)}` : "Ты в расчёте";
}

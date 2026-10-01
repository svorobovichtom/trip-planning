import { useTotalG } from "../../lib/hooks";
import { fmtG } from "../../lib/money";
import { plural } from "../../lib/plural";
import { useExpenses } from "../../lib/stores";

/** Header line on «Расходы». */
export function usePaymentsSummary(): string {
  const n = useExpenses().size;
  const tg = useTotalG();
  return n ? `${fmtG(tg)} · ${n} ${plural(n, "чек", "чека", "чеков")}` : "чеков пока нет";
}

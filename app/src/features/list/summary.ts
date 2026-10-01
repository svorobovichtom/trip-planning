import { useListStats, useTotalG } from "../../lib/hooks";
import { fmtG } from "../../lib/money";

/** Header line on «Список». */
export function useListSummary(): string {
  const { done, total } = useListStats();
  const tg = useTotalG();
  return `${done} из ${total} куплено${tg ? ` · ${fmtG(tg)} по чекам` : ""}`;
}

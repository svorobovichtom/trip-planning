import { useState } from "react";
import { doneCount, resetAllItems } from "../../lib/actions";
import { useListStats } from "../../lib/hooks";
import { canWriteKey, shareUrl } from "../../lib/pb";
import { plural } from "../../lib/plural";
import { openMore, useUi } from "../../lib/stores";
import { Sheet } from "../../ui/Sheet";
import { toast } from "../../ui/toast";
import { exportCsv } from "../totals/csv";

/** «Ещё»: the trip menu, share link, reset all checks, CSV. */
export function MoreSheet() {
  const open = useUi((s) => s.moreOpen);
  const { done } = useListStats();
  const [confirming, setConfirming] = useState(false);

  const share = async () => {
    const url = shareUrl();
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: "Покупки и расходы поездки", url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Ссылка скопирована");
      }
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") prompt("Скопируй ссылку:", url);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        openMore(o);
        if (!o) setConfirming(false);
      }}
      title="Ещё"
    >
      <div className="menu">
        <h2>Меню</h2>
        <span className="k">ужин пт → завтрак вс · гриль</span>
        <dl>
          <dt>Пт ужин</dt>
          <dd>Гриль: шея, курица, колбаски, картошка, салат. Для одного: лосось</dd>
          <dt>Сб завтрак</dt>
          <dd>Сырники со сметаной, яйца, хлеб, сыр, нарезка, овощи</dd>
          <dt>Сб обед</dt>
          <dd>Лёгкий перекус перед выездом: бутерброды, овощи, фрукты</dd>
          <dt>Сб ужин</dt>
          <dd>Лосось на гриле, немного шеи, пюре, овощи гриль, салат</dd>
          <dt>Вс завтрак</dt>
          <dd>Без готовки: йогурт с гранолой и фруктами, бутерброды, кофе</dd>
        </dl>
      </div>
      <p className="note">
        Один человек ест рыбу без мяса: ему лосось в пятницу и копчёный лосось к завтракам. Соль, перец и специи сначала проверить
        в доме. Напитки и алкоголь не включены.
      </p>
      <ul className="list acts">
        {canWriteKey && (
          <li>
            <button className="prow" type="button" onClick={share}>
              <span className="nm">Ссылка для группы</span>
              <span className="cur">поделиться</span>
            </button>
          </li>
        )}
        {canWriteKey &&
          (confirming ? (
            <li className="confirm">
              <span className="nm">
                Снять {done} {plural(done, "отметку", "отметки", "отметок")}?
              </span>
              <button className="btn" type="button" onClick={() => setConfirming(false)}>
                Отмена
              </button>
              <button
                className="btn pri"
                type="button"
                onClick={() => {
                  const n = resetAllItems();
                  setConfirming(false);
                  openMore(false);
                  if (n) toast(`Снято отметок: ${n}`);
                }}
              >
                Снять
              </button>
            </li>
          ) : (
            <li>
              <button
                className="prow"
                type="button"
                onClick={() => {
                  if (!doneCount()) toast("Отметок нет");
                  else setConfirming(true);
                }}
              >
                <span className="nm">Снять все отметки</span>
                <span className="cur">{done ? String(done) : ""}</span>
              </button>
            </li>
          ))}
        <li>
          <button
            className="prow"
            type="button"
            onClick={() => {
              openMore(false);
              exportCsv();
            }}
          >
            <span className="nm">Скачать расходы</span>
            <span className="cur">CSV</span>
          </button>
        </li>
      </ul>
    </Sheet>
  );
}

import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useState } from "react";
import { reducedMotion } from "../../lib/haptics";
import { type Tab, TABS } from "../../lib/stores";
import { useScrollEl } from "../../ui/scroll";

const LABELS: Record<Tab, string> = { list: "Список", exp: "Расходы", sum: "Итоги" };

/** Floating pill (solid ink) with a sliding indicator; tapping the current tab scrolls to the top. */
export function TabBar({ tab }: { tab: Tab }) {
  const scroll = useScrollEl();
  // No slide on first paint: the indicator appears in place, then animates.
  const [still, setStill] = useState(true);
  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => (r2 = requestAnimationFrame(() => setStill(false))));
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);
  return (
    <Tabs.List className={`nav${still ? " still" : ""}`} aria-label="Разделы">
      <Tabs.Indicator className="ind" renderBeforeHydration />
      {TABS.map((t) => (
        <Tabs.Tab
          key={t}
          value={t}
          className="tab"
          onClick={() => {
            if (t === tab) scroll.current?.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
          }}
        >
          {LABELS[t]}
        </Tabs.Tab>
      ))}
    </Tabs.List>
  );
}

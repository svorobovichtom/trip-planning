import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Header } from "./features/shell/Header";
import { ProfileSheet } from "./features/shell/ProfileSheet";
import { TabBar } from "./features/shell/TabBar";
import { ListPage } from "./features/list/ListPage";
import { canWriteKey } from "./lib/pb";
import { currentPerson, dataStore, openWho, setTab, type Tab, TABS, useUi } from "./lib/stores";
import { startSync } from "./lib/sync";
import { ConfirmHost } from "./ui/Confirm";
import { lazyPart, PartBoundary, whenIdle } from "./ui/lazy";
import { ScrollContext } from "./ui/scroll";
import { ToastProvider } from "./ui/Toaster";
import "./features/shell/shell.css";

// «Расходы» and «Итоги» are separate chunks, so the first paint of «Список»
// parses less. They are fetched and mounted (hidden) after the first idle,
// which keeps tab switches instant; opening one earlier loads it on demand.
const PaymentsPage = lazyPart(() => import("./features/payments/PaymentsPage"), (m) => m.PaymentsPage);
const TotalsPage = lazyPart(() => import("./features/totals/TotalsPage"), (m) => m.TotalsPage);
const tabSkel = <div className="skel" aria-busy="true" aria-label="Загружаю" />;

/** Tabs whose content is mounted: the current one, then all after the first idle. */
function useMountedTabs(tab: Tab): (t: Tab) => boolean {
  const [warm, setWarm] = useState(false);
  const seen = useRef(new Set<Tab>());
  seen.current.add(tab);
  useEffect(
    () =>
      whenIdle(() => {
        void Promise.all([PaymentsPage.preload(), TotalsPage.preload()])
          .catch(() => {})
          .then(() => setWarm(true));
      }),
    [],
  );
  return (t) => warm || seen.current.has(t);
}

export function App() {
  const tab = useUi((s) => s.tab);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabScroll = useRef<Partial<Record<Tab, number>>>({});
  const prevTab = useRef(tab);
  const mounted = useMountedTabs(tab);

  // Each tab keeps its own scroll position.
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc || prevTab.current === tab) return;
    sc.scrollTop = tabScroll.current[tab] ?? 0;
    prevTab.current = tab;
  }, [tab]);
  const onTab = (v: unknown) => {
    if (!TABS.includes(v as Tab)) return;
    if (scrollRef.current) tabScroll.current[prevTab.current] = scrollRef.current.scrollTop;
    setTab(v as Tab);
  };

  useEffect(() => {
    void startSync().then(() => {
      if (canWriteKey && dataStore.get().loaded && !currentPerson()) openWho(true);
    });
  }, []);

  // Hide the tab bar while typing, so it doesn't float over fields above the keyboard.
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && el.matches("input:not([type=file]):not([type=checkbox]),textarea,select");
    const onIn = (e: FocusEvent) => isField(e.target) && document.body.classList.add("typing");
    const onOut = (e: FocusEvent) => !isField(e.relatedTarget) && document.body.classList.remove("typing");
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  return (
    <ToastProvider>
      <ScrollContext.Provider value={scrollRef}>
        <Tabs.Root className="app" value={tab} onValueChange={onTab}>
          <Header />
          <div className="scroll" ref={scrollRef}>
            <div className="wrap">
              <Tabs.Panel value="list" keepMounted className="panel panel-list">
                <ListPage />
              </Tabs.Panel>
              <Tabs.Panel value="exp" keepMounted className="panel">
                {mounted("exp") && (
                  <PartBoundary fallback={tabSkel}>
                    <PaymentsPage />
                  </PartBoundary>
                )}
              </Tabs.Panel>
              <Tabs.Panel value="sum" keepMounted className="panel">
                {mounted("sum") && (
                  <PartBoundary fallback={tabSkel}>
                    <TotalsPage />
                  </PartBoundary>
                )}
              </Tabs.Panel>
            </div>
          </div>
          <TabBar tab={tab} />
        </Tabs.Root>
        <ProfileSheet />
        <ConfirmHost />
      </ScrollContext.Provider>
    </ToastProvider>
  );
}

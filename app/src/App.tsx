import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Header } from "./features/shell/Header";
import { MoreSheet } from "./features/shell/MoreSheet";
import { TabBar } from "./features/shell/TabBar";
import { WhoSheet } from "./features/shell/WhoSheet";
import { ListPage } from "./features/list/ListPage";
import { PaymentsPage } from "./features/payments/PaymentsPage";
import { TotalsPage } from "./features/totals/TotalsPage";
import { canWriteKey } from "./lib/pb";
import { currentPerson, dataStore, openWho, setTab, type Tab, TABS, useUi } from "./lib/stores";
import { startSync } from "./lib/sync";
import { ScrollContext } from "./ui/scroll";
import { ToastProvider } from "./ui/Toaster";
import "./features/shell/shell.css";

export function App() {
  const tab = useUi((s) => s.tab);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabScroll = useRef<Partial<Record<Tab, number>>>({});
  const prevTab = useRef(tab);

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
                <PaymentsPage />
              </Tabs.Panel>
              <Tabs.Panel value="sum" keepMounted className="panel">
                <TotalsPage />
              </Tabs.Panel>
            </div>
          </div>
          <TabBar tab={tab} />
        </Tabs.Root>
        <WhoSheet />
        <MoreSheet />
      </ScrollContext.Provider>
    </ToastProvider>
  );
}

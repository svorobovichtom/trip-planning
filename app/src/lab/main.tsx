// Drawer lab (/next/lab.html): Base UI's own bottom-drawer demo (verbatim)
// next to our <Sheet>, inside our app layout or a plain scrolling page.
// For comparing behaviour on a real phone. Not linked from the app.
import { Drawer } from "@base-ui/react/drawer";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import "../features/shell/shell.css";
import { Sheet } from "../ui/Sheet";
import styles from "./demo.module.css";

const plain = new URLSearchParams(location.search).get("layout") === "page";
if (plain) document.documentElement.classList.add("lab-page");

function DemoDrawer() {
  return (
    <Drawer.Root>
      <Drawer.Trigger className={styles.Button}>1 · Их пример (копия)</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop className={styles.Backdrop} />
        <Drawer.Viewport className={styles.Viewport}>
          <Drawer.Popup className={styles.Popup}>
            <div className={styles.Handle} />
            <Drawer.Content className={styles.Content}>
              <Drawer.Title className={styles.Title}>Notifications</Drawer.Title>
              <Drawer.Description className={styles.Description}>You are all caught up. Good job!</Drawer.Description>
              <div className={styles.Actions}>
                <Drawer.Close className={styles.Button}>Close</Drawer.Close>
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Lab() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const rows = Array.from({ length: 40 }, (_, i) => <p key={i} style={{ margin: "0 0 12px" }}>Строка {i + 1}</p>);
  const controls = (
    <div style={{ display: "grid", gap: 12, padding: 16 }}>
      <b>Drawer lab · {plain ? "обычная страница" : "раскладка приложения"}</b>
      <a href={plain ? "lab.html" : "lab.html?layout=page"}>переключить на {plain ? "раскладку приложения" : "обычную страницу"}</a>
      <DemoDrawer />
      <button type="button" className={styles.Button} onClick={() => setA(true)}>2 · Наше окно (текст)</button>
      <button type="button" className={styles.Button} onClick={() => setB(true)}>3 · Наше окно (поле ввода)</button>
    </div>
  );
  const sheets = (
    <>
      <Sheet open={a} onOpenChange={setA} title="Наше окно">
        <p className="lead">Тот же Base UI Drawer, наши стили.</p>
        {rows.slice(0, 6)}
      </Sheet>
      <Sheet open={b} onOpenChange={setB} title="С полем ввода" keyboard>
        <input className="in" placeholder="Имя" style={{ width: "100%" }} />
        {rows.slice(0, 4)}
      </Sheet>
    </>
  );
  if (plain) return <div style={{ padding: "0 0 40px" }}>{controls}{rows}{sheets}</div>;
  return (
    <div className="app">
      <header style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>Шапка (как в приложении)</header>
      <div className="scroll">{controls}<div style={{ padding: 16 }}>{rows}</div></div>
      {sheets}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Lab />);

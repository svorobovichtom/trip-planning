import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell (scope /). Production builds only.
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || local)) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
}
// The app lived at /next/ before the switch; that address now redirects to /,
// so its old service worker can't update itself. Remove it.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.filter((r) => new URL(r.scope).pathname.startsWith("/next/")).forEach((r) => r.unregister()))
    .catch(() => {});
}

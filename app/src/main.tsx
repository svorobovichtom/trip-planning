import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline shell (scope /next/). Production builds only.
const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (import.meta.env.PROD && "serviceWorker" in navigator && (location.protocol === "https:" || local)) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
}

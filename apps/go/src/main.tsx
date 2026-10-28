// Karya Go — entry. SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// oxlint-disable-next-line import/no-unassigned-import -- side-effect CSS
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/go/sw.js", { scope: "/go/" }).catch(() => undefined)
  );

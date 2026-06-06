import { createRoot } from "react-dom/client";
import App from "./App";
import styles from "./styles.css?inline";

const HOST_ID = "dremio-chat-extension-host";

function mountExtension() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const mountPoint = document.createElement("div");
  mountPoint.id = "dremio-chat-mount";
  mountPoint.style.pointerEvents = "auto";
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(<App />);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountExtension);
} else {
  mountExtension();
}

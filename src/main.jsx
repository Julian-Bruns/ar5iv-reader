import { render } from "preact";
import App from "./App";
import "./styles/app.css";

render(<App />, document.getElementById("app"));

registerServiceWorker();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const urls = collectShellUrls();
      const postUrls = () => {
        const target =
          registration.active ||
          registration.waiting ||
          registration.installing;
        target?.postMessage({ type: "PRECACHE_URLS", urls });
      };

      postUrls();
      navigator.serviceWorker.ready.then(postUrls).catch(() => {});
    } catch (error) {
      console.error("Service worker registration failed", error);
    }
  });
}

function collectShellUrls() {
  const urls = new Set([
    "/",
    "/index.html",
    "/manifest.webmanifest",
    "/icons/icon.svg",
    "/icons/maskable.svg"
  ]);

  for (const element of document.querySelectorAll("script[src], link[href]")) {
    const value = element.getAttribute("src") || element.getAttribute("href");
    if (!value) {
      continue;
    }

    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin) {
        urls.add(url.pathname + url.search);
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  for (const entry of performance.getEntriesByType("resource")) {
    try {
      const url = new URL(entry.name);
      if (url.origin === window.location.origin) {
        urls.add(url.pathname + url.search);
      }
    } catch {
      // Ignore opaque entries.
    }
  }

  return [...urls];
}

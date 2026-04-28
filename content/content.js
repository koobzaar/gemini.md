(() => {
  "use strict";

  const MESSAGE_SOURCE = "ai-md-extension";
  const ROOT_ID = "ai-md-export-root";
  const SCRIPT_ID = "ai-md-page-exporter";

  const app = detectApp();
  if (!app || document.getElementById(ROOT_ID)) return;

  let button;
  let exporterReady = false;

  createUi();
  window.addEventListener("message", handlePageMessage);
  injectPageExporter();

  function detectApp() {
    const host = location.hostname;
    if (host === "gemini.google.com") return "gemini";
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com") {
      return "chatgpt";
    }
    return null;
  }

  function createUi() {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "ai-md-export";
    root.dataset.app = app;

    const tab = document.createElement("div");
    tab.className = "ai-md-export__tab";
    tab.setAttribute("aria-hidden", "true");

    const panel = document.createElement("div");
    panel.className = "ai-md-export__panel";

    button = document.createElement("button");
    button.type = "button";
    button.className = "ai-md-export__button";
    button.textContent = "Preparing...";
    button.disabled = true;
    button.addEventListener("click", requestExport);

    panel.append(button);
    root.append(tab, panel);
    document.documentElement.append(root);
  }

  function injectPageExporter() {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = browser.runtime.getURL("page/exporter.js");
    script.async = false;
    script.addEventListener("error", () => {
      setButtonState("Exporter failed", true);
      console.error("[ai.md] Failed to inject page exporter.");
    });

    (document.head || document.documentElement).append(script);
    script.remove();
  }

  function requestExport() {
    if (!exporterReady || button.disabled) return;
    window.postMessage({ source: MESSAGE_SOURCE, type: "AI_MD_EXPORT" }, window.location.origin);
  }

  function handlePageMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE) return;

    if (data.type === "AI_MD_READY") {
      exporterReady = true;
      setButtonState("Export .md", false);
      return;
    }

    if (data.type === "AI_MD_STATUS") {
      setButtonState(data.text || "Export .md", Boolean(data.disabled));
      return;
    }

    if (data.type === "AI_MD_ERROR") {
      const message = data.message || "Export failed.";
      setButtonState("Export .md", false);
      window.alert(message);
    }
  }

  function setButtonState(text, disabled) {
    if (!button) return;
    button.textContent = text;
    button.disabled = disabled;
  }
})();

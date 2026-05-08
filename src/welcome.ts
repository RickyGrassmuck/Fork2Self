import "./sources/index.js";
import "./backends/index.js";

import {
  addDestination,
  emptyBackendConfig,
  loadConfig,
  normalizeHostname,
  registry,
  requestHostPermission,
  setSourceTokens,
} from "./core.js";
import type { BackendConfig } from "./types.js";

// Bitbucket Cloud's app passwords need <user>:<password>, so a single PAT
// doesn't authenticate cloning. Skip it from the seeded list.
const TOKEN_SKIP_SOURCE_IDS = new Set(["bitbucket"]);

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let selectedBackendId = "";
let connectionVerified = false;
let lastWhoami: { login: string; displayName: string } | null = null;

document.addEventListener("DOMContentLoaded", () => { void init(); });

async function init(): Promise<void> {
  renderBackendChoices();
  wireEvents();

  const cfg = await loadConfig();
  // Pre-fill the source-tokens grid with existing tokens (non-destructive
  // re-run); destination credentials are intentionally NOT pre-filled,
  // because each wizard run creates a new destination.
  seedTokenRows(cfg.sourceTokens);

  goToStep(1);
}

function seedTokenRows(existing: Record<string, string>): void {
  const seen = new Set<string>();
  for (const klass of registry.listSources()) {
    if (TOKEN_SKIP_SOURCE_IDS.has(klass.id)) continue;
    for (const host of klass.hostnames) {
      if (seen.has(host)) continue;
      seen.add(host);
      addTokenRow(host, existing[host] || "");
    }
  }
  for (const [host, token] of Object.entries(existing)) {
    if (seen.has(host)) continue;
    addTokenRow(host, token);
  }
}

function addTokenRow(host: string, token: string): void {
  const row = document.createElement("div");
  row.className = "token-row";

  const hostInput = document.createElement("input");
  hostInput.type = "text";
  hostInput.placeholder = "github.com";
  hostInput.value = host;
  hostInput.dataset["role"] = "host";

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "personal access token";
  tokenInput.autocomplete = "off";
  tokenInput.value = token;
  tokenInput.dataset["role"] = "token";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-btn";
  remove.title = "Remove";
  remove.setAttribute("aria-label", `Remove ${host || "row"}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => row.remove());

  row.appendChild(hostInput);
  row.appendChild(tokenInput);
  row.appendChild(remove);
  $("source-tokens-list").appendChild(row);
}

function collectTokenRows(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of $("source-tokens-list").querySelectorAll<HTMLElement>(".token-row")) {
    const hostInput = row.querySelector<HTMLInputElement>('[data-role="host"]');
    const tokenInput = row.querySelector<HTMLInputElement>('[data-role="token"]');
    if (!hostInput || !tokenInput) continue;
    const host = normalizeHostname(hostInput.value);
    const token = tokenInput.value;
    if (host && token) map[host] = token;
  }
  return map;
}

function renderBackendChoices(): void {
  const container = $("backend-choices");
  for (const cls of registry.listBackends()) {
    const wrapper = document.createElement("label");
    wrapper.className = "choice";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "backend";
    radio.value = cls.id;
    radio.addEventListener("change", () => {
      selectedBackendId = cls.id;
      // Default the destination name to the backend label until the user
      // edits it themselves.
      const nameField = $<HTMLInputElement>("destName");
      if (!nameField.value || nameField.dataset["autoFilled"] === "true") {
        nameField.value = cls.label;
        nameField.dataset["autoFilled"] = "true";
      }
    });

    const text = document.createElement("div");
    const lbl = document.createElement("div");
    lbl.className = "label";
    lbl.textContent = cls.label;
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = cls.description;
    text.appendChild(lbl);
    text.appendChild(desc);

    wrapper.appendChild(radio);
    wrapper.appendChild(text);
    container.appendChild(wrapper);
  }
}

function wireEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = Number(btn.dataset["go"]);
      if (Number.isFinite(step)) goToStep(step);
    });
  });

  $("step2-next").addEventListener("click", () => {
    if (!selectedBackendId) {
      flashChoiceListError("Pick a destination platform first.");
      return;
    }
    setupStep3();
    goToStep(3);
  });

  $("test").addEventListener("click", () => onTest());
  $("step3-next").addEventListener("click", () => { void onSaveAndContinue(); });

  $("add-token-row").addEventListener("click", () => addTokenRow("", ""));
  $("skip-tokens").addEventListener("click", () => goToStep(5));
  $("step4-next").addEventListener("click", () => { void onSaveTokens(); });

  $<HTMLInputElement>("destName").addEventListener("input", () => {
    // User typed something — stop auto-filling on backend re-select.
    $<HTMLInputElement>("destName").dataset["autoFilled"] = "false";
  });
  $<HTMLInputElement>("baseUrl").addEventListener("input", () => {
    connectionVerified = false;
    $<HTMLButtonElement>("step3-next").disabled = true;
    $("test-status").hidden = true;
  });
  $<HTMLInputElement>("token").addEventListener("input", () => {
    connectionVerified = false;
    $<HTMLButtonElement>("step3-next").disabled = true;
    $("test-status").hidden = true;
  });

  $("open-options").addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
  });
  $("finish").addEventListener("click", () => { void closeSelf(); });
}

function setupStep3(): void {
  const klass = registry.getBackendClass(selectedBackendId);
  if (!klass) return;
  $("backend-name").textContent = klass.label;
  $("token-help").textContent = klass.tokenHelp;
}

function flashChoiceListError(msg: string): void {
  const status = $("test-status");
  status.hidden = false;
  status.className = "status error";
  status.textContent = msg;
  setTimeout(() => { status.hidden = true; }, 2500);
}

async function onTest(): Promise<void> {
  const klass = registry.getBackendClass(selectedBackendId);
  if (!klass) return;

  const baseUrl = $<HTMLInputElement>("baseUrl").value.trim().replace(/\/+$/, "");
  const token = $<HTMLInputElement>("token").value.trim();
  if (!baseUrl || !token) {
    setStatus("Enter the base URL and token first.", "error");
    return;
  }

  const granted = await requestHostPermission(baseUrl);
  if (!granted) {
    setStatus("Host permission denied.", "error");
    return;
  }

  setStatus("Testing…", "");
  try {
    const cfg: BackendConfig = { ...emptyBackendConfig(), baseUrl, token };
    const backend = new klass(cfg);
    const me = await backend.whoami();
    lastWhoami = { login: me.login || "", displayName: me.displayName || "" };
    connectionVerified = true;
    $<HTMLButtonElement>("step3-next").disabled = false;
    setStatus(`Connected as ${me.login || "user"}.`, "success");
  } catch (err) {
    connectionVerified = false;
    $<HTMLButtonElement>("step3-next").disabled = true;
    setStatus(`Failed: ${(err as Error).message}`, "error");
  }
}

async function onSaveAndContinue(): Promise<void> {
  if (!connectionVerified) {
    setStatus("Test the connection first.", "error");
    return;
  }
  const klass = registry.getBackendClass(selectedBackendId);
  if (!klass) return;

  const name = $<HTMLInputElement>("destName").value.trim() || klass.label;
  const baseUrl = $<HTMLInputElement>("baseUrl").value.trim().replace(/\/+$/, "");
  const token = $<HTMLInputElement>("token").value.trim();
  const defaultOwner = lastWhoami?.login || "";

  const granted = await requestHostPermission(baseUrl);
  if (!granted) {
    setStatus("Host permission denied.", "error");
    return;
  }

  await addDestination({
    id: crypto.randomUUID(),
    name,
    backendId: selectedBackendId,
    config: { ...emptyBackendConfig(), baseUrl, token, defaultOwner },
  });

  $("done-instance").textContent = `${name} (${baseUrl})`;
  $("done-owner").textContent = defaultOwner || "(none — set one in settings)";
  $("done-backend").textContent = klass.label;

  goToStep(4);
}

async function onSaveTokens(): Promise<void> {
  const tokens = collectTokenRows();
  await setSourceTokens(tokens);
  goToStep(5);
}

function setStatus(text: string, kind: "success" | "error" | ""): void {
  const el = $("test-status");
  el.hidden = false;
  el.textContent = text;
  el.className = "status inline" + (kind ? " " + kind : "");
}

function goToStep(step: number): void {
  document.querySelectorAll<HTMLElement>(".step").forEach((el) => {
    el.hidden = Number(el.dataset["step"]) !== step;
  });
  document.querySelectorAll<HTMLElement>(".step-indicator li").forEach((el) => {
    const n = Number(el.dataset["step"]);
    el.classList.toggle("active", n === step);
    el.classList.toggle("done", n < step);
  });
}

async function closeSelf(): Promise<void> {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab && tab.id !== undefined) {
      await browser.tabs.remove(tab.id);
      return;
    }
  } catch { /* ignore */ }
  window.close();
}

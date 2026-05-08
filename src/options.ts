import "./sources/index.js";
import "./backends/index.js";

import {
  addDestination,
  deleteDestination,
  emptyBackendConfig,
  getDefaultDestination,
  getDestinationById,
  loadConfig,
  normalizeHostname,
  registry,
  requestHostPermission,
  setDefaultDestinationId,
  updateDestination,
} from "./core.js";
import {
  CAPABILITY_KEYS,
  CONTENT_CAPABILITY_KEYS,
  type AppConfig,
  type BackendConfig,
  type Destination,
} from "./types.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// Maps form field id → key inside backend config's `defaults` map.
const DEFAULT_FIELDS: Record<string, keyof BackendConfig["defaults"]> = {
  defaultPrivate: "private",
  defaultMirror: "mirror",
  includeWiki: "wiki",
  includeLabels: "labels",
  includeIssues: "issues",
  includePullRequests: "pullRequests",
  includeReleases: "releases",
  includeMilestones: "milestones",
};

let appConfig: AppConfig = {
  destinations: [], defaultDestinationId: null,
  openAfterFork: true, customSourceHosts: {}, sourceTokens: {},
};
// id of the destination being edited; `null` means a new (unsaved) one.
let editingId: string | null = null;

document.addEventListener("DOMContentLoaded", () => { void init(); });

async function init(): Promise<void> {
  $<HTMLFormElement>("form").addEventListener("submit", (e) => onSave(e));
  $("test").addEventListener("click", () => onTest());
  $<HTMLSelectElement>("backendId").addEventListener("change", () => onBackendChange());
  $<HTMLSelectElement>("destinationSelect").addEventListener("change", () => onDestinationChange());
  $("dest-new").addEventListener("click", () => onNewDestination());
  $("dest-set-default").addEventListener("click", () => { void onSetDefault(); });
  $("dest-delete").addEventListener("click", () => { void onDeleteDestination(); });
  $("add-host").addEventListener("click", () => addHostRow("", ""));
  $("add-token").addEventListener("click", () => addTokenRow("", ""));
  $("open-welcome").addEventListener("click", () => {
    void browser.tabs.create({ url: browser.runtime.getURL("welcome.html") });
  });
  setupTabs();

  // Populate the backend dropdown once.
  const backendSelect = $<HTMLSelectElement>("backendId");
  for (const cls of registry.listBackends()) {
    const opt = document.createElement("option");
    opt.value = cls.id;
    opt.textContent = cls.label;
    backendSelect.appendChild(opt);
  }

  renderBuiltinSourcesLine();

  appConfig = await loadConfig();
  $<HTMLInputElement>("openAfterFork").checked = appConfig.openAfterFork;

  loadCustomHosts(appConfig.customSourceHosts);
  loadSourceTokens(appConfig.sourceTokens);

  refreshDestinationsUi(appConfig.defaultDestinationId);
}

function renderBuiltinSourcesLine(): void {
  const parts: string[] = [];
  for (const klass of registry.listSources()) {
    if (!klass.hostnames.length) continue;
    parts.push(`${klass.label} (${klass.hostnames.join(", ")})`);
  }
  $("builtin-sources").textContent = parts.length
    ? `Built-in: ${parts.join(" · ")}.`
    : "";
}

// Re-render the destination selector and load the appropriate destination
// into the form. If `selectId` is provided and matches a destination, it's
// selected; otherwise the default (or first, or "new") is selected.
function refreshDestinationsUi(selectId: string | null): void {
  const select = $<HTMLSelectElement>("destinationSelect");
  select.replaceChildren();

  for (const d of appConfig.destinations) {
    const opt = document.createElement("option");
    opt.value = d.id;
    const klass = registry.getBackendClass(d.backendId);
    const isDefault = d.id === appConfig.defaultDestinationId ? " (default)" : "";
    opt.textContent = `${d.name}${klass ? ` — ${klass.label}` : ""}${isDefault}`;
    select.appendChild(opt);
  }

  if (appConfig.destinations.length === 0) {
    $("no-destinations").hidden = false;
    select.disabled = true;
    $("dest-set-default").hidden = true;
    $("dest-delete").hidden = true;
    enterNewDestinationForm();
    return;
  }

  $("no-destinations").hidden = true;
  select.disabled = false;
  $("dest-set-default").hidden = false;
  $("dest-delete").hidden = false;

  let target = selectId
    ? getDestinationById(appConfig, selectId)
    : getDefaultDestination(appConfig);
  if (!target) target = appConfig.destinations[0]!;
  select.value = target.id;
  loadDestinationIntoForm(target);
}

function loadDestinationIntoForm(dest: Destination): void {
  editingId = dest.id;
  $<HTMLInputElement>("destName").value = dest.name;
  $<HTMLSelectElement>("backendId").value = dest.backendId;
  $<HTMLInputElement>("baseUrl").value = dest.config.baseUrl;
  $<HTMLInputElement>("token").value = dest.config.token;
  $<HTMLInputElement>("defaultOwner").value = dest.config.defaultOwner;
  for (const [field, key] of Object.entries(DEFAULT_FIELDS)) {
    $<HTMLInputElement>(field).checked = !!dest.config.defaults[key];
  }
  applyBackendUi(dest.backendId);
  updateDefaultBadge();
  $("test-status").hidden = true;
  $("save-status").hidden = true;
}

function enterNewDestinationForm(): void {
  editingId = null;
  const klass = registry.listBackends()[0];
  if (!klass) return;
  const empty = emptyBackendConfig();
  $<HTMLInputElement>("destName").value = klass.label;
  $<HTMLSelectElement>("backendId").value = klass.id;
  $<HTMLInputElement>("baseUrl").value = "";
  $<HTMLInputElement>("token").value = "";
  $<HTMLInputElement>("defaultOwner").value = "";
  for (const [field, key] of Object.entries(DEFAULT_FIELDS)) {
    $<HTMLInputElement>(field).checked = empty.defaults[key];
  }
  applyBackendUi(klass.id);
  updateDefaultBadge();
  $("test-status").hidden = true;
  $("save-status").hidden = true;
  $<HTMLInputElement>("destName").focus();
}

function updateDefaultBadge(): void {
  const isDefault = editingId !== null && editingId === appConfig.defaultDestinationId;
  $("default-badge").hidden = !isDefault;
  ($("dest-set-default") as HTMLButtonElement).disabled = isDefault || editingId === null;
}

function applyBackendUi(id: string): void {
  const klass = registry.getBackendClass(id);
  if (!klass) return;

  $("backend-description").textContent = klass.description || "";
  $("token-help").textContent = klass.tokenHelp || "";

  const caps = klass.capabilities;
  for (const cap of CAPABILITY_KEYS) {
    document.querySelectorAll<HTMLElement>(`[data-cap="${cap}"]`).forEach((el) => {
      el.hidden = !caps[cap];
    });
  }
  $("include-set").hidden = !CONTENT_CAPABILITY_KEYS.some((c) => caps[c]);
}

function onBackendChange(): void {
  applyBackendUi($<HTMLSelectElement>("backendId").value);
}

function onDestinationChange(): void {
  const id = $<HTMLSelectElement>("destinationSelect").value;
  const dest = getDestinationById(appConfig, id);
  if (dest) loadDestinationIntoForm(dest);
}

function onNewDestination(): void {
  // Just clear the form; saving creates the entry.
  enterNewDestinationForm();
}

async function onSetDefault(): Promise<void> {
  if (!editingId) return;
  await setDefaultDestinationId(editingId);
  appConfig = await loadConfig();
  refreshDestinationsUi(editingId);
}

async function onDeleteDestination(): Promise<void> {
  if (!editingId) return;
  const dest = getDestinationById(appConfig, editingId);
  if (!dest) return;
  if (!confirm(`Delete destination "${dest.name}"? This won't affect anything in the destination instance itself.`)) return;
  await deleteDestination(editingId);
  appConfig = await loadConfig();
  refreshDestinationsUi(appConfig.defaultDestinationId);
}

function collectFormConfig(): { name: string; backendId: string; config: BackendConfig } {
  const defaults = { ...emptyBackendConfig().defaults };
  for (const [field, key] of Object.entries(DEFAULT_FIELDS)) {
    defaults[key] = $<HTMLInputElement>(field).checked;
  }
  return {
    name: $<HTMLInputElement>("destName").value.trim(),
    backendId: $<HTMLSelectElement>("backendId").value,
    config: {
      baseUrl: $<HTMLInputElement>("baseUrl").value.trim().replace(/\/+$/, ""),
      token: $<HTMLInputElement>("token").value.trim(),
      defaultOwner: $<HTMLInputElement>("defaultOwner").value.trim(),
      defaults,
    },
  };
}

function onSave(e: SubmitEvent): void {
  e.preventDefault();
  const form = collectFormConfig();
  if (!form.name) {
    setStatus("save-status", "Name is required.", "error");
    return;
  }
  const customHosts = collectCustomHosts();
  const sourceTokens = collectSourceTokens();

  const permRequest = form.config.baseUrl
    ? requestHostPermission(form.config.baseUrl)
    : Promise.resolve(true);

  permRequest.then(async (granted) => {
    if (!granted) {
      setStatus("save-status", "Host permission denied — extension can't reach that origin.", "error");
      return;
    }
    if (editingId) {
      await updateDestination(editingId, {
        name: form.name, backendId: form.backendId, config: form.config,
      });
    } else {
      const newId = crypto.randomUUID();
      await addDestination({ id: newId, name: form.name, backendId: form.backendId, config: form.config });
      editingId = newId;
    }
    await browser.storage.local.set({
      openAfterFork: $<HTMLInputElement>("openAfterFork").checked,
      customSourceHosts: customHosts,
      sourceTokens,
    });
    appConfig = await loadConfig();
    refreshDestinationsUi(editingId);
    setStatus("save-status", "Saved.", "success");
    setTimeout(() => { $("save-status").hidden = true; }, 2500);
  }).catch((err: Error) => {
    setStatus("save-status", `Failed: ${err.message}`, "error");
  });
}

function onTest(): void {
  const form = collectFormConfig();
  const klass = registry.getBackendClass(form.backendId);
  if (!klass) {
    setStatus("test-status", "Unknown backend.", "error");
    return;
  }
  if (!form.config.baseUrl || !form.config.token) {
    setStatus("test-status", "Enter the base URL and token first.", "error");
    return;
  }

  requestHostPermission(form.config.baseUrl).then(async (granted) => {
    if (!granted) {
      setStatus("test-status", "Host permission denied.", "error");
      return;
    }
    setStatus("test-status", "Testing…", "");
    try {
      const backend = new klass(form.config);
      const me = await backend.whoami();
      const ownerField = $<HTMLInputElement>("defaultOwner");
      let suffix = "";
      if (me.login && !ownerField.value.trim()) {
        ownerField.value = me.login;
        suffix = " — filled in default owner.";
      }
      setStatus("test-status", `Connected as ${me.login || "user"}.${suffix}`, "success");
    } catch (err) {
      setStatus("test-status", `Failed: ${(err as Error).message}`, "error");
    }
  }).catch((err: Error) => {
    setStatus("test-status", `Failed: ${err.message}`, "error");
  });
}

function loadCustomHosts(map: Record<string, string>): void {
  const list = $("custom-hosts-list");
  list.replaceChildren();
  for (const [host, type] of Object.entries(map || {})) {
    addHostRow(host, type);
  }
}

function addHostRow(host: string, type: string): void {
  const row = document.createElement("div");
  row.className = "host-row";

  const hostInput = document.createElement("input");
  hostInput.type = "text";
  hostInput.placeholder = "git.example.com";
  hostInput.value = host || "";
  hostInput.dataset["role"] = "host";

  const select = document.createElement("select");
  select.dataset["role"] = "type";
  for (const klass of registry.listSources()) {
    const opt = document.createElement("option");
    opt.value = klass.id;
    opt.textContent = klass.label;
    select.appendChild(opt);
  }
  if (type) select.value = type;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());

  row.appendChild(hostInput);
  row.appendChild(select);
  row.appendChild(remove);
  $("custom-hosts-list").appendChild(row);
}

function loadSourceTokens(map: Record<string, string>): void {
  const list = $("source-tokens-list");
  list.replaceChildren();
  for (const [host, token] of Object.entries(map || {})) {
    addTokenRow(host, token);
  }
}

function addTokenRow(host: string, token: string): void {
  const row = document.createElement("div");
  row.className = "token-row";

  const hostInput = document.createElement("input");
  hostInput.type = "text";
  hostInput.placeholder = "github.com";
  hostInput.value = host || "";
  hostInput.dataset["role"] = "host";

  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "personal access token";
  tokenInput.autocomplete = "off";
  tokenInput.value = token || "";
  tokenInput.dataset["role"] = "token";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => row.remove());

  row.appendChild(hostInput);
  row.appendChild(tokenInput);
  row.appendChild(remove);
  $("source-tokens-list").appendChild(row);
}

function collectCustomHosts(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of $("custom-hosts-list").querySelectorAll<HTMLElement>(".host-row")) {
    const host = normalizeHostname(row.querySelector<HTMLInputElement>('[data-role="host"]')!.value);
    const type = row.querySelector<HTMLSelectElement>('[data-role="type"]')!.value;
    if (host && type) map[host] = type;
  }
  return map;
}

function collectSourceTokens(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of $("source-tokens-list").querySelectorAll<HTMLElement>(".token-row")) {
    const host = normalizeHostname(row.querySelector<HTMLInputElement>('[data-role="host"]')!.value);
    const token = row.querySelector<HTMLInputElement>('[data-role="token"]')!.value;
    if (host && token) map[host] = token;
  }
  return map;
}

function setupTabs(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.tabs button[role="tab"]');
  const panels = document.querySelectorAll<HTMLElement>('.tab-panel');
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset["tab"];
      buttons.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      panels.forEach((p) => { p.hidden = p.id !== `tab-${target}`; });
    });
  });
}

function setStatus(id: string, text: string, kind: "success" | "error" | ""): void {
  const el = $(id);
  el.hidden = false;
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

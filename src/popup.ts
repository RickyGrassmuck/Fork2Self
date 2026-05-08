import "./sources/index.js";
import "./backends/index.js";

import {
  clearMigrations,
  consumePendingPopupTab,
  detectSource,
  effectiveCapabilities,
  getDefaultDestination,
  getDestinationById,
  loadConfig,
  loadMigrations,
  registry,
  safeHttpUrl,
  updateDestination,
} from "./core.js";
import {
  CAPABILITY_KEYS,
  CONTENT_CAPABILITY_KEYS,
  type AppConfig,
  type BackendClass,
  type BackendDefaults,
  type Destination,
  type ForkRequest,
  type ForkResponse,
  type MigrationRecord,
  type Repo,
  type SourceClass,
} from "./types.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

interface FieldRefs {
  destination: HTMLSelectElement;
  owner: HTMLInputElement;
  repoName: HTMLInputElement;
  description: HTMLInputElement;
  private: HTMLInputElement;
  mirror: HTMLInputElement;
  wiki: HTMLInputElement;
  labels: HTMLInputElement;
  issues: HTMLInputElement;
  pullRequests: HTMLInputElement;
  releases: HTMLInputElement;
  milestones: HTMLInputElement;
}

let fields: FieldRefs;
let appConfig: AppConfig | null = null;
let currentRepo: Repo | null = null;
let activeSourceClass: SourceClass | null = null;
let activeDestination: Destination | null = null;

document.addEventListener("DOMContentLoaded", () => { void init(); });

async function init(): Promise<void> {
  fields = {
    destination: $<HTMLSelectElement>("destination"),
    owner: $<HTMLInputElement>("owner"),
    repoName: $<HTMLInputElement>("repo-name"),
    description: $<HTMLInputElement>("description"),
    private: $<HTMLInputElement>("private"),
    mirror: $<HTMLInputElement>("mirror"),
    wiki: $<HTMLInputElement>("wiki"),
    labels: $<HTMLInputElement>("labels"),
    issues: $<HTMLInputElement>("issues"),
    pullRequests: $<HTMLInputElement>("pullRequests"),
    releases: $<HTMLInputElement>("releases"),
    milestones: $<HTMLInputElement>("milestones"),
  };

  $("open-options").addEventListener("click", () => browser.runtime.openOptionsPage());
  $("open-options-2").addEventListener("click", () => browser.runtime.openOptionsPage());
  $("open-options-3").addEventListener("click", () => browser.runtime.openOptionsPage());
  $<HTMLFormElement>("fork-form").addEventListener("submit", (e) => { void onSubmit(e); });
  $("clear-history").addEventListener("click", () => { void onClearHistory(); });
  fields.destination.addEventListener("change", () => onDestinationChange());

  setupTabs();
  void renderHistory();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes["migrations"]) {
      void renderHistory();
    }
  });

  void consumePendingPopupTab().then((pending) => {
    if (pending === "history") switchToTab("history");
  });

  appConfig = await loadConfig();
  if (appConfig.destinations.length === 0) {
    show("not-configured");
    return;
  }

  populateDestinationSelect(appConfig);

  const def = getDefaultDestination(appConfig);
  if (def) fields.destination.value = def.id;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const detected = tab ? detectSource(tab.url || "", appConfig.customSourceHosts) : null;
  if (!detected) {
    show("not-repo");
    // We still update the header to reflect the default destination.
    updateHeaderForDestination(def);
    return;
  }

  const sourceKlass = registry.getSourceClass(detected.sourceId);
  if (!sourceKlass) {
    show("not-repo");
    return;
  }

  activeSourceClass = sourceKlass;
  currentRepo = detected.repo;

  $("source-label").textContent = sourceKlass.label;
  $("source-repo").textContent = `${detected.repo.owner}/${detected.repo.repo}`;

  applyDestination(def ?? null);
  show("fork-form");
}

function populateDestinationSelect(cfg: AppConfig): void {
  fields.destination.replaceChildren();
  for (const d of cfg.destinations) {
    const opt = document.createElement("option");
    opt.value = d.id;
    const klass = registry.getBackendClass(d.backendId);
    const isDefault = d.id === cfg.defaultDestinationId ? " (default)" : "";
    opt.textContent = `${d.name}${klass ? ` — ${klass.label}` : ""}${isDefault}`;
    fields.destination.appendChild(opt);
  }
}

function updateHeaderForDestination(dest: Destination | null | undefined): void {
  if (!dest) {
    $("backend-label").textContent = "self-hosted Git";
    return;
  }
  $("backend-label").textContent = dest.name;
  $("submit").textContent = `Fork to ${dest.name}`;
}

function applyDestination(dest: Destination | null): void {
  if (!dest) return;
  activeDestination = dest;
  updateHeaderForDestination(dest);

  const backendKlass = registry.getBackendClass(dest.backendId);
  const sourceKlass = activeSourceClass;
  if (!backendKlass || !sourceKlass || !currentRepo) return;

  applyEffectiveCapabilities(backendKlass, sourceKlass);

  const bcfg = dest.config;
  fields.owner.value = bcfg.defaultOwner || "";
  fields.repoName.value = currentRepo.repo;
  fields.description.value = `Mirror of ${currentRepo.cloneUrl}`;
  fields.private.checked = bcfg.defaults.private;
  fields.mirror.checked = bcfg.defaults.mirror;
  fields.wiki.checked = bcfg.defaults.wiki;
  fields.labels.checked = bcfg.defaults.labels;
  fields.issues.checked = bcfg.defaults.issues;
  fields.pullRequests.checked = bcfg.defaults.pullRequests;
  fields.releases.checked = bcfg.defaults.releases;
  fields.milestones.checked = bcfg.defaults.milestones;

  if (!bcfg.defaultOwner) void resolveOwnerFromBackend(dest);
}

function onDestinationChange(): void {
  if (!appConfig) return;
  const dest = getDestinationById(appConfig, fields.destination.value);
  if (dest) applyDestination(dest);
}

function applyEffectiveCapabilities(backendKlass: BackendClass, sourceKlass: SourceClass): void {
  const caps = effectiveCapabilities(backendKlass, sourceKlass);
  for (const cap of CAPABILITY_KEYS) {
    document.querySelectorAll<HTMLElement>(`[data-cap="${cap}"]`).forEach((el) => {
      el.hidden = !caps[cap];
    });
  }
  const anyContent = CONTENT_CAPABILITY_KEYS.some((c) => caps[c]);
  $("include-section").hidden = !anyContent;
}

async function resolveOwnerFromBackend(dest: Destination): Promise<void> {
  const klass = registry.getBackendClass(dest.backendId);
  if (!klass) return;
  const placeholder = fields.owner.placeholder;
  fields.owner.placeholder = "Looking up your username…";
  try {
    const backend = new klass(dest.config);
    const me = await backend.whoami();
    if (!me.login) return;
    if (activeDestination?.id !== dest.id) return; // user switched destinations
    if (!fields.owner.value.trim()) fields.owner.value = me.login;
    await updateDestination(dest.id, {
      config: { ...dest.config, defaultOwner: me.login },
    });
  } catch {
    /* leave the field blank */
  } finally {
    fields.owner.placeholder = placeholder;
  }
}

function show(id: "not-repo" | "not-configured" | "fork-form"): void {
  for (const sec of ["not-repo", "not-configured", "fork-form"] as const) {
    $(sec).hidden = sec !== id;
  }
}

async function onSubmit(e: SubmitEvent): Promise<void> {
  e.preventDefault();
  if (!currentRepo || !activeSourceClass || !activeDestination) return;

  const overrides: Partial<BackendDefaults> & {
    owner?: string;
    repoName?: string;
    description?: string;
  } = {
    owner: fields.owner.value.trim(),
    repoName: fields.repoName.value.trim(),
    description: fields.description.value,
    private: fields.private.checked,
    mirror: fields.mirror.checked,
    wiki: fields.wiki.checked,
    labels: fields.labels.checked,
    issues: fields.issues.checked,
    pullRequests: fields.pullRequests.checked,
    releases: fields.releases.checked,
    milestones: fields.milestones.checked,
  };

  setStatusText("Migrating…", "");
  $<HTMLButtonElement>("submit").disabled = true;
  switchToTab("history");

  const request: ForkRequest = {
    type: "fork",
    sourceId: activeSourceClass.id,
    destinationId: activeDestination.id,
    repo: currentRepo,
    overrides,
  };

  browser.runtime.sendMessage(request)
    .then((raw: unknown) => {
      const resp = raw as ForkResponse | undefined;
      if (resp && resp.ok) {
        const url = safeHttpUrl(resp.result.htmlUrl);
        if (url) setStatusLink("Created ", url, resp.result.fullName || url);
        else setStatusText("Created.", "success");
      } else {
        const err = (resp && !resp.ok) ? resp.error : "unknown error";
        setStatusText(`Failed: ${err}`, "error");
      }
    })
    .catch((err: unknown) => {
      setStatusText(`Failed: ${(err as Error).message}`, "error");
    })
    .finally(() => {
      $<HTMLButtonElement>("submit").disabled = false;
    });
}

function setupTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button[role="tab"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset["tab"];
      if (target) switchToTab(target);
    });
  });
}

function switchToTab(name: string): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button[role="tab"]').forEach((b) => {
    b.setAttribute("aria-selected", String(b.dataset["tab"] === name));
  });
  document.querySelectorAll<HTMLElement>('.tab-panel').forEach((p) => {
    p.hidden = p.id !== `tab-${name}`;
  });
}

async function renderHistory(): Promise<void> {
  const list = await loadMigrations();
  const container = $("history-list");
  container.replaceChildren();

  if (list.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No migrations yet.";
    container.appendChild(empty);
    $("history-actions").hidden = true;
    return;
  }

  for (const r of list) {
    container.appendChild(renderHistoryItem(r));
  }
  $("history-actions").hidden = false;
}

function renderHistoryItem(r: MigrationRecord): HTMLElement {
  const card = document.createElement("div");
  card.className = `history-item history-${r.status}`;

  const header = document.createElement("div");
  header.className = "history-header";

  const icon = document.createElement("span");
  icon.className = "history-icon";
  icon.textContent = r.status === "success" ? "✓" : r.status === "failed" ? "✗" : "⏳";

  const time = document.createElement("span");
  time.className = "history-time";
  time.textContent = formatTime(r.startedAt);

  header.appendChild(icon);
  header.appendChild(time);
  card.appendChild(header);

  const sourceRow = document.createElement("div");
  sourceRow.className = "history-source";
  sourceRow.textContent = `${r.source.label}: ${r.source.owner}/${r.source.repo}`;
  card.appendChild(sourceRow);

  const dest = document.createElement("div");
  dest.className = "history-arrow";
  dest.textContent = `→ ${r.destination.destinationName} · ${r.destination.owner}/${r.destination.repoName}`;
  card.appendChild(dest);

  const safeHtmlUrl = safeHttpUrl(r.destination.htmlUrl);
  if (r.status === "success" && safeHtmlUrl) {
    const link = document.createElement("a");
    link.href = safeHtmlUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = r.destination.fullName || safeHtmlUrl;
    link.className = "history-link";
    card.appendChild(link);
  } else if (r.status === "failed" && r.error) {
    // TODO: When the destination wasn't auto-cleaned up (Gitea only does
    // this for rate-limit failures today), surface a "Delete repo" button
    // on the history item that calls the backend's delete API.
    const err = document.createElement("div");
    err.className = "history-error";
    err.textContent = r.error;
    card.appendChild(err);
  } else if (r.status === "pending") {
    const pending = document.createElement("div");
    pending.className = "history-arrow";
    pending.textContent = "Migrating…";
    card.appendChild(pending);
  }

  return card;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

async function onClearHistory(): Promise<void> {
  await clearMigrations();
}

function setStatusText(text: string, kind: "success" | "error" | ""): void {
  const el = $("status");
  el.hidden = false;
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function setStatusLink(prefix: string, href: string, label: string): void {
  const el = $("status");
  el.hidden = false;
  el.className = "status success";
  el.textContent = prefix;
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = label;
  el.appendChild(a);
}

import {
  type AppConfig,
  type BackendClass,
  type BackendConfig,
  type BackendDefaults,
  type Capabilities,
  type Destination,
  type Detection,
  type MigrateOptions,
  type MigrateOverrides,
  type MigrationRecord,
  type Repo,
  type SourceClass,
  CAPABILITY_KEYS,
} from "./types.js";

// Per-context registries. Each entry-point bundle owns its own instance —
// background, popup, and options pages don't share runtime state.
class Registry {
  readonly backends = new Map<string, BackendClass>();
  readonly sources = new Map<string, SourceClass>();

  registerBackend(klass: BackendClass): void {
    if (!klass.id) throw new Error("Backend missing static id");
    this.backends.set(klass.id, klass);
  }

  registerSource(klass: SourceClass): void {
    if (!klass.id) throw new Error("Source missing static id");
    this.sources.set(klass.id, klass);
  }

  getBackendClass(id: string): BackendClass | undefined {
    return this.backends.get(id);
  }

  getSourceClass(id: string): SourceClass | undefined {
    return this.sources.get(id);
  }

  listBackends(): BackendClass[] {
    return Array.from(this.backends.values());
  }

  listSources(): SourceClass[] {
    return Array.from(this.sources.values());
  }
}

export const registry = new Registry();

// Canonicalize a hostname or partial URL for comparison/storage.
// Strips scheme, path, leading "www.", and trailing whitespace, then lowercases.
export function normalizeHostname(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

// Returns `url` only if it's a well-formed http(s) URL — otherwise null.
// Use before passing a URL from an external API response into a sink like
// `tabs.create` or `<a href>`, where `javascript:` / `data:` could execute
// attacker content if the destination instance is compromised.
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
}

// Ask the browser for host permission to reach `baseUrl`'s origin.
// Returns false if the URL is malformed or the user denies.
export function requestHostPermission(baseUrl: string): Promise<boolean> {
  let origin: string;
  try { origin = new URL(baseUrl).origin + "/*"; }
  catch { return Promise.resolve(false); }
  return browser.permissions.request({ origins: [origin] });
}

// Effective capability = backend AND source. A toggle should only show in
// the UI if both ends agree.
export function effectiveCapabilities(
  backendKlass: BackendClass | undefined,
  sourceKlass: SourceClass | undefined,
): Capabilities {
  const out: Capabilities = {
    mirror: false, private: false, wiki: false, labels: false,
    issues: false, pullRequests: false, releases: false, milestones: false,
  };
  const bcaps = backendKlass?.capabilities;
  const scaps = sourceKlass?.capabilities;
  if (!bcaps || !scaps) return out;
  for (const k of CAPABILITY_KEYS) {
    out[k] = !!bcaps[k] && !!scaps[k];
  }
  return out;
}

// Detects which Source class can parse the given URL. Custom hostname map
// (user-configured "this self-hosted host is type X") overrides built-in
// matchers.
export function detectSource(
  urlStr: string,
  customHosts: Record<string, string>,
): Detection | null {
  let url: URL;
  try { url = new URL(urlStr); } catch { return null; }
  const host = normalizeHostname(url.hostname);

  const customId = customHosts?.[host];
  if (customId) {
    const klass = registry.getSourceClass(customId);
    if (klass) {
      const repo = klass.parsePath(url, host);
      if (repo) return { sourceId: klass.id, repo };
    }
  }

  for (const klass of registry.listSources()) {
    if (!klass.matchesHost(host)) continue;
    const repo = klass.parsePath(url, host);
    if (repo) return { sourceId: klass.id, repo };
  }
  return null;
}

// All hostnames the extension recognizes — built-in source hostnames plus
// any user-mapped custom ones. Used to scope context-menu visibility.
export function knownSourceHostnames(customHosts: Record<string, string>): string[] {
  const hosts = new Set<string>();
  for (const klass of registry.listSources()) {
    for (const h of klass.hostnames) hosts.add(h);
  }
  for (const h of Object.keys(customHosts || {})) hosts.add(h);
  return Array.from(hosts);
}

const DEFAULT_BACKEND_FLAGS: BackendDefaults = {
  private: false,
  mirror: false,
  wiki: true,
  issues: false,
  labels: true,
  pullRequests: false,
  releases: false,
  milestones: false,
};

export function emptyBackendConfig(): BackendConfig {
  return {
    baseUrl: "",
    token: "",
    defaultOwner: "",
    defaults: { ...DEFAULT_BACKEND_FLAGS },
  };
}

interface RawConfig {
  destinations?: Destination[];
  defaultDestinationId?: string | null;
  openAfterFork?: boolean;
  customSourceHosts?: Record<string, string>;
  sourceTokens?: Record<string, string>;
}

export async function loadConfig(): Promise<AppConfig> {
  const raw = (await browser.storage.local.get(null)) as RawConfig;
  return {
    destinations: raw.destinations ?? [],
    defaultDestinationId: raw.defaultDestinationId ?? null,
    openAfterFork: raw.openAfterFork !== false,
    customSourceHosts: raw.customSourceHosts ?? {},
    sourceTokens: raw.sourceTokens ?? {},
  };
}

// Lookup helpers --------------------------------------------------

export function getDestinationById(cfg: AppConfig, id: string | null | undefined): Destination | undefined {
  if (!id) return undefined;
  return cfg.destinations.find((d) => d.id === id);
}

export function getDefaultDestination(cfg: AppConfig): Destination | undefined {
  return getDestinationById(cfg, cfg.defaultDestinationId)
    || cfg.destinations[0];
}

export function getDestinationOrDefault(cfg: AppConfig, id: string | null | undefined): Destination | undefined {
  return getDestinationById(cfg, id) || getDefaultDestination(cfg);
}

// Mutation helpers ------------------------------------------------

export async function setDestinations(destinations: Destination[]): Promise<void> {
  await browser.storage.local.set({ destinations });
}

export async function addDestination(d: Destination): Promise<void> {
  const cfg = await loadConfig();
  const next = [...cfg.destinations, d];
  await setDestinations(next);
  // First destination becomes the default automatically.
  if (cfg.destinations.length === 0) {
    await setDefaultDestinationId(d.id);
  }
}

export async function updateDestination(id: string, patch: Partial<Destination>): Promise<void> {
  const cfg = await loadConfig();
  const next = cfg.destinations.map((d) => (d.id === id ? { ...d, ...patch } : d));
  await setDestinations(next);
}

export async function deleteDestination(id: string): Promise<void> {
  const cfg = await loadConfig();
  const next = cfg.destinations.filter((d) => d.id !== id);
  await setDestinations(next);
  if (cfg.defaultDestinationId === id) {
    await setDefaultDestinationId(next[0]?.id ?? null);
  }
}

export async function setDefaultDestinationId(id: string | null): Promise<void> {
  await browser.storage.local.set({ defaultDestinationId: id });
}

export async function setGlobalSetting<K extends keyof AppConfig>(key: K, value: AppConfig[K]): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function getCustomSourceHosts(): Promise<Record<string, string>> {
  const raw = (await browser.storage.local.get("customSourceHosts")) as { customSourceHosts?: Record<string, string> };
  return raw.customSourceHosts || {};
}

export async function setCustomSourceHosts(map: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ customSourceHosts: map || {} });
}

export async function setSourceTokens(map: Record<string, string>): Promise<void> {
  await browser.storage.local.set({ sourceTokens: map || {} });
}

const MIGRATIONS_KEY = "migrations";
const MIGRATIONS_CAP = 50;

export async function loadMigrations(): Promise<MigrationRecord[]> {
  const raw = (await browser.storage.local.get(MIGRATIONS_KEY)) as { migrations?: MigrationRecord[] };
  return Array.isArray(raw.migrations) ? raw.migrations : [];
}

export async function appendMigration(record: MigrationRecord): Promise<void> {
  const list = await loadMigrations();
  list.unshift(record);
  await browser.storage.local.set({ [MIGRATIONS_KEY]: list.slice(0, MIGRATIONS_CAP) });
}

export async function updateMigration(id: string, patch: Partial<MigrationRecord>): Promise<void> {
  const list = await loadMigrations();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return;
  const existing = list[idx]!;
  list[idx] = {
    ...existing,
    ...patch,
    destination: patch.destination
      ? { ...existing.destination, ...patch.destination }
      : existing.destination,
    source: patch.source ? { ...existing.source, ...patch.source } : existing.source,
  };
  await browser.storage.local.set({ [MIGRATIONS_KEY]: list });
}

export async function clearMigrations(): Promise<void> {
  await browser.storage.local.set({ [MIGRATIONS_KEY]: [] });
}

// Transient signal from the background → popup: "next time you open, start
// on this tab". Consumed (cleared) on read.
const PENDING_POPUP_TAB_KEY = "pendingPopupTab";

export async function setPendingPopupTab(name: string): Promise<void> {
  await browser.storage.local.set({ [PENDING_POPUP_TAB_KEY]: name });
}

export async function consumePendingPopupTab(): Promise<string | null> {
  const raw = (await browser.storage.local.get(PENDING_POPUP_TAB_KEY)) as { pendingPopupTab?: string };
  const value = raw.pendingPopupTab || null;
  if (value !== null) {
    await browser.storage.local.remove(PENDING_POPUP_TAB_KEY);
  }
  return value;
}

// Look up the auth token to use for a source clone URL by hostname.
export function lookupSourceToken(
  cloneUrl: string,
  tokens: Record<string, string>,
): string | null {
  if (!tokens) return null;
  let host: string;
  try { host = normalizeHostname(new URL(cloneUrl).hostname); }
  catch { return null; }
  return tokens[host] || null;
}

export function buildMigrateOptions(
  bcfg: BackendConfig,
  overrides: MigrateOverrides,
  owner: string,
  repo: Repo,
  sourceKlass: SourceClass,
): MigrateOptions {
  const d = bcfg.defaults;
  const pick = <K extends keyof BackendDefaults>(k: K): boolean =>
    overrides[k] !== undefined ? !!overrides[k] : d[k];
  return {
    owner,
    repoName: overrides.repoName || repo.repo,
    description: overrides.description !== undefined
      ? overrides.description
      : `Mirror of ${repo.cloneUrl}`,
    private: pick("private"),
    mirror: pick("mirror"),
    wiki: pick("wiki"),
    issues: pick("issues"),
    labels: pick("labels"),
    pullRequests: pick("pullRequests"),
    releases: pick("releases"),
    milestones: pick("milestones"),
    giteaService: sourceKlass.giteaService,
    sourceId: sourceKlass.id,
    sourceLabel: sourceKlass.label,
  };
}

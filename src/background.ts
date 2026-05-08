import "./sources/index.js";
import "./backends/index.js";

import {
  appendMigration,
  buildMigrateOptions,
  detectSource,
  getCustomSourceHosts,
  getDefaultDestination,
  getDestinationById,
  knownSourceHostnames,
  loadConfig,
  lookupSourceToken,
  registry,
  safeHttpUrl,
  setPendingPopupTab,
  updateDestination,
  updateMigration,
} from "./core.js";
import type {
  Destination,
  ForkRequest,
  ForkResponse,
  MigrateOverrides,
  MigrateResult,
  MigrationRecord,
  Repo,
} from "./types.js";

// Menu id encoding: "fork2self|<page|link>|<destinationId|null>".
// "fork2self|page|null" is the placeholder shown when no destinations are
// configured; clicking it opens the options page.
const MENU_PARENT_OTHERS_PAGE = "fork2self-others-page";
const MENU_PARENT_OTHERS_LINK = "fork2self-others-link";

function menuIdFor(context: "page" | "link", destinationId: string | null): string {
  return `fork2self|${context}|${destinationId ?? "null"}`;
}

function parseMenuId(id: string): { context: "page" | "link"; destinationId: string | null } | null {
  if (!id.startsWith("fork2self|")) return null;
  const parts = id.split("|");
  if (parts.length !== 3) return null;
  const ctx = parts[1];
  if (ctx !== "page" && ctx !== "link") return null;
  const destId = parts[2] === "null" ? null : parts[2]!;
  return { context: ctx, destinationId: destId };
}

browser.runtime.onInstalled.addListener((details) => {
  void rebuildContextMenus();
  if (details.reason === "install") {
    void browser.tabs.create({ url: browser.runtime.getURL("welcome.html") });
  }
});

browser.runtime.onStartup?.addListener(() => {
  void rebuildContextMenus();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes["destinations"] || changes["defaultDestinationId"] || changes["customSourceHosts"]) {
    void rebuildContextMenus();
  }
});

browser.contextMenus.onClicked.addListener(async (info) => {
  const parsed = typeof info.menuItemId === "string" ? parseMenuId(info.menuItemId) : null;
  if (!parsed) return;

  // No-destination placeholder click.
  if (parsed.destinationId === null) {
    void browser.runtime.openOptionsPage();
    return;
  }

  const url = parsed.context === "link" ? info.linkUrl : info.pageUrl;
  if (!url) return;
  const customs = await getCustomSourceHosts();
  const detected = detectSource(url, customs);
  if (!detected) {
    notify("Fork", "That URL doesn't look like a recognized repository.");
    return;
  }
  // Tell the popup to open on History, then try to open it.
  await setPendingPopupTab("history");
  void openPopupIfSupported();
  try {
    await runFork(detected.sourceId, parsed.destinationId, detected.repo, {});
  } catch {
    /* runFork already notifies */
  }
});

async function openPopupIfSupported(): Promise<void> {
  try {
    await browser.action.openPopup();
  } catch { /* unsupported or blocked */ }
}

browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isForkRequest(msg)) return false;
  runFork(msg.sourceId, msg.destinationId, msg.repo, msg.overrides || {})
    .then((result) => {
      const response: ForkResponse = { ok: true, result };
      sendResponse(response);
    })
    .catch((err: Error & { status?: number }) => {
      const response: ForkResponse = {
        ok: false,
        error: err.message,
        ...(err.status !== undefined ? { status: err.status } : {}),
      };
      sendResponse(response);
    });
  return true;
});

function isForkRequest(msg: unknown): msg is ForkRequest {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Partial<ForkRequest>;
  if (m.type !== "fork") return false;
  if (typeof m.sourceId !== "string" || !m.sourceId) return false;
  if (typeof m.destinationId !== "string" || !m.destinationId) return false;
  const r = m.repo;
  if (!r || typeof r !== "object") return false;
  return typeof r.owner === "string"
    && typeof r.repo === "string"
    && typeof r.cloneUrl === "string"
    && typeof r.htmlUrl === "string";
}

async function runFork(
  sourceId: string,
  destinationId: string,
  repo: Repo,
  overrides: MigrateOverrides,
): Promise<MigrateResult> {
  const sourceKlass = registry.getSourceClass(sourceId);
  if (!sourceKlass) {
    notify("Fork — failed", `Unknown source: ${sourceId}`);
    throw new Error(`Unknown source: ${sourceId}`);
  }

  const cfg = await loadConfig();
  const destination = getDestinationById(cfg, destinationId)
    || getDefaultDestination(cfg);
  if (!destination) {
    notify("Fork", "No destination configured. Opening settings…");
    void browser.runtime.openOptionsPage();
    throw new Error("No destination configured");
  }

  const backendKlass = registry.getBackendClass(destination.backendId);
  if (!backendKlass) {
    notify("Fork — failed", `Unknown backend: ${destination.backendId}`);
    throw new Error(`Unknown backend: ${destination.backendId}`);
  }

  const bcfg = destination.config;
  if (!bcfg.baseUrl || !bcfg.token) {
    notify(`Fork to ${destination.name}`, "Destination is not configured. Opening settings…");
    void browser.runtime.openOptionsPage();
    throw new Error("Destination not configured");
  }
  const backend = new backendKlass(bcfg);

  let owner = overrides.owner || bcfg.defaultOwner;
  if (!owner) {
    try {
      const me = await backend.whoami();
      if (me.login) {
        owner = me.login;
        await updateDestination(destination.id, {
          config: { ...bcfg, defaultOwner: me.login },
        });
      }
    } catch { /* fall through */ }
  }
  if (!owner) {
    notify(`Fork to ${destination.name}`, "No destination owner configured.");
    void browser.runtime.openOptionsPage();
    throw new Error("No destination owner");
  }

  const options = buildMigrateOptions(bcfg, overrides, owner, repo, sourceKlass);
  const sourceToken = lookupSourceToken(repo.cloneUrl, cfg.sourceTokens);
  if (sourceToken) options.authToken = sourceToken;

  const record: MigrationRecord = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    status: "pending",
    source: {
      id: sourceKlass.id,
      label: sourceKlass.label,
      owner: repo.owner,
      repo: repo.repo,
      htmlUrl: repo.htmlUrl,
    },
    destination: {
      destinationId: destination.id,
      destinationName: destination.name,
      backendId: backendKlass.id,
      backendLabel: backendKlass.label,
      owner,
      repoName: options.repoName,
    },
  };
  await appendMigration(record);

  notify(
    `Fork to ${destination.name}`,
    `Migrating ${sourceKlass.label}: ${repo.owner}/${repo.repo} → ${owner}/${options.repoName}…`,
  );

  try {
    const result = await backend.migrate(repo, options);
    await updateMigration(record.id, {
      status: "success",
      endedAt: Date.now(),
      destination: { ...record.destination, htmlUrl: result.htmlUrl, fullName: result.fullName },
    });
    notify(
      `Fork to ${destination.name} — done`,
      result.fullName ? `Created ${result.fullName}` : "Created.",
    );
    const openUrl = cfg.openAfterFork ? safeHttpUrl(result.htmlUrl) : null;
    if (openUrl) {
      browser.tabs.create({ url: openUrl, active: true }).catch(() => { /* ignore */ });
    }
    return result;
  } catch (err) {
    const e = err as Error;
    await updateMigration(record.id, {
      status: "failed",
      endedAt: Date.now(),
      error: e.message || "Unknown error",
    });
    notify(`Fork to ${destination.name} — failed`, e.message || "Unknown error");
    throw err;
  }
}

async function rebuildContextMenus(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();

    const cfg = await loadConfig();
    const hosts = knownSourceHostnames(cfg.customSourceHosts);
    const patterns = hosts.length
      ? hosts.map((h) => `*://${h}/*`)
      : ["*://github.com/*"];

    if (cfg.destinations.length === 0) {
      // Placeholder: clicking opens settings.
      browser.contextMenus.create({
        id: menuIdFor("page", null),
        title: "Fork to… (configure a destination first)",
        contexts: ["page"],
        documentUrlPatterns: patterns,
      });
      browser.contextMenus.create({
        id: menuIdFor("link", null),
        title: "Fork to… (configure a destination first)",
        contexts: ["link"],
        targetUrlPatterns: patterns,
      });
      return;
    }

    const def = getDefaultDestination(cfg);
    if (!def) return;
    const others = cfg.destinations.filter((d) => d.id !== def.id);

    createDestinationItems(def, others, "page", patterns);
    createDestinationItems(def, others, "link", patterns);
  } catch {
    /* menus may be in flux during install */
  }
}

function createDestinationItems(
  def: Destination,
  others: Destination[],
  context: "page" | "link",
  patterns: string[],
): void {
  const isPage = context === "page";
  const urlPatterns = isPage
    ? { documentUrlPatterns: patterns }
    : { targetUrlPatterns: patterns };

  // Top-level: one-click to default.
  browser.contextMenus.create({
    id: menuIdFor(context, def.id),
    title: `Fork to ${def.name}`,
    contexts: [isPage ? "page" : "link"],
    ...urlPatterns,
  });

  if (others.length === 0) return;

  // Submenu parent for the non-default destinations.
  const parentId = isPage ? MENU_PARENT_OTHERS_PAGE : MENU_PARENT_OTHERS_LINK;
  browser.contextMenus.create({
    id: parentId,
    title: "Fork to other destination",
    contexts: [isPage ? "page" : "link"],
    ...urlPatterns,
  });
  for (const dest of others) {
    browser.contextMenus.create({
      id: menuIdFor(context, dest.id),
      title: dest.name,
      parentId,
      contexts: [isPage ? "page" : "link"],
      ...urlPatterns,
    });
  }
}

function notify(title: string, message: string): void {
  const opts: browser.notifications.CreateNotificationOptions = {
    type: "basic", title, message,
    iconUrl: browser.runtime.getURL("icons/icon.svg"),
  };
  browser.notifications.create(opts).catch(() => {
    delete (opts as { iconUrl?: string }).iconUrl;
    browser.notifications.create(opts).catch(() => { /* ignore */ });
  });
}

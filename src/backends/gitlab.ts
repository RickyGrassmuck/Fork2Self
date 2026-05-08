import { registry } from "../core.js";
import type {
  BackendClass,
  BackendConfig,
  BackendInstance,
  Capabilities,
  MigrateOptions,
  MigrateResult,
  Repo,
  UserInfo,
} from "../types.js";

const CAPS: Capabilities = {
  mirror: false, private: true, wiki: false,
  issues: false, labels: false, pullRequests: false,
  releases: false, milestones: false,
};

interface GitlabUser {
  username?: string;
  name?: string;
  web_url?: string;
}

interface GitlabNamespace {
  id: number;
  full_path?: string;
  path?: string;
  name?: string;
}

interface GitlabProject {
  path_with_namespace?: string;
  web_url?: string;
}

interface GitlabError {
  message?: string | Record<string, unknown>;
  error?: string;
}

// GitLab CE/EE. Uses POST /api/v4/projects with import_url for code-only
// import. Issues / PRs / wiki / labels / releases / milestones aren't
// transferred by this endpoint — that requires the dedicated GitHub importer
// (POST /api/v4/import/github), which needs a *GitHub* PAT and isn't covered
// here. Pull-mirroring is GitLab EE only, so the mirror capability is off.
export class GitLabBackend implements BackendInstance {
  static readonly id = "gitlab";
  static readonly label = "GitLab";
  static readonly description = "GitLab CE/EE — code import via import_url. Issues, PRs, etc. are not included (that path requires the GitHub importer + GitHub token).";
  static readonly tokenHelp = "In GitLab: User Settings → Access Tokens. Required scope: api.";
  static readonly capabilities: Capabilities = CAPS;

  private readonly baseUrl: string;
  private readonly token: string;

  constructor(cfg: BackendConfig) {
    this.baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    this.token = cfg.token || "";
  }

  async whoami(): Promise<UserInfo> {
    const res = await fetch(`${this.baseUrl}/api/v4/user`, { headers: this.headers() });
    if (!res.ok) throw await this.error(res);
    const u = await res.json() as GitlabUser;
    return {
      login: u.username || "",
      displayName: u.name || u.username || "",
      htmlUrl: u.web_url || "",
    };
  }

  async migrate(source: Repo, options: MigrateOptions): Promise<MigrateResult> {
    const me = await this.whoami();
    const owner = options.owner || me.login;

    // Posting to your own user namespace doesn't need namespace_id; for any
    // other user/group, look up the namespace_id by name first.
    let namespaceId: number | null = null;
    if (owner && owner !== me.login) {
      namespaceId = await this.lookupNamespaceId(owner);
      if (namespaceId == null) {
        throw new Error(`Namespace not found in GitLab: ${owner}`);
      }
    }

    let importUrl = source.cloneUrl;
    if (options.authToken && options.sourceId) {
      const sourceKlass = registry.getSourceClass(options.sourceId);
      if (sourceKlass) {
        importUrl = sourceKlass.authedCloneUrl(source, options.authToken);
      }
    }

    const payload: Record<string, unknown> = {
      name: options.repoName,
      path: options.repoName,
      import_url: importUrl,
      visibility: options.private ? "private" : "public",
      description: options.description || "",
    };
    if (namespaceId != null) payload["namespace_id"] = namespaceId;

    const res = await fetch(`${this.baseUrl}/api/v4/projects`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await this.error(res);
    const body = await res.json() as GitlabProject;
    return {
      fullName: body.path_with_namespace || `${owner}/${options.repoName}`,
      htmlUrl: body.web_url || "",
    };
  }

  private async lookupNamespaceId(name: string): Promise<number | null> {
    const url = `${this.baseUrl}/api/v4/namespaces?search=${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw await this.error(res);
    const list = await res.json() as GitlabNamespace[];
    if (!Array.isArray(list)) return null;
    const exact = list.find(n => n.full_path === name)
      || list.find(n => n.path === name)
      || list.find(n => n.name === name);
    return exact ? exact.id : null;
  }

  private headers(): Record<string, string> {
    return {
      "PRIVATE-TOKEN": this.token,
      "Accept": "application/json",
    };
  }

  private async error(res: Response): Promise<Error & { status?: number }> {
    let msg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const body = await res.json() as GitlabError;
      if (body) {
        if (typeof body.message === "string") msg = body.message;
        else if (body.message) msg = JSON.stringify(body.message);
        else if (body.error) msg = body.error;
      }
    } catch { /* ignore */ }
    const err: Error & { status?: number } = new Error(msg);
    err.status = res.status;
    return err;
  }
}

const _: BackendClass = GitLabBackend;
void _;

registry.registerBackend(GitLabBackend);

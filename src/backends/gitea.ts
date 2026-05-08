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
  mirror: true, private: true, wiki: true,
  issues: true, labels: true, pullRequests: true,
  releases: true, milestones: true,
};

interface GiteaUser {
  login?: string;
  username?: string;
  full_name?: string;
  html_url?: string;
}

interface GiteaRepo {
  full_name?: string;
  html_url?: string;
}

interface GiteaError {
  message?: string;
}

export class GiteaBackend implements BackendInstance {
  static readonly id = "gitea";
  static readonly label = "Gitea / Forgejo";
  static readonly description = "Gitea or Forgejo (API-compatible). Migrates code, optionally with issues, PRs, labels, releases, milestones, and wiki.";
  static readonly tokenHelp = "In Gitea: Settings → Applications → Generate New Token. Required scopes: write:repository, read:user.";
  static readonly capabilities: Capabilities = CAPS;

  private readonly baseUrl: string;
  private readonly token: string;

  constructor(cfg: BackendConfig) {
    this.baseUrl = (cfg.baseUrl || "").replace(/\/+$/, "");
    this.token = cfg.token || "";
  }

  async whoami(): Promise<UserInfo> {
    const res = await fetch(`${this.baseUrl}/api/v1/user`, { headers: this.headers() });
    if (!res.ok) throw await this.error(res);
    const u = await res.json() as GiteaUser;
    return {
      login: u.login || u.username || "",
      displayName: u.full_name || u.login || "",
      htmlUrl: u.html_url || "",
    };
  }

  async migrate(source: Repo, options: MigrateOptions): Promise<MigrateResult> {
    const payload: Record<string, unknown> = {
      clone_addr: source.cloneUrl,
      repo_name: options.repoName,
      repo_owner: options.owner,
      service: options.giteaService || "git",
      mirror: !!options.mirror,
      private: !!options.private,
      description: options.description,
      wiki: !!options.wiki,
      issues: !!options.issues,
      labels: !!options.labels,
      releases: !!options.releases,
      milestones: !!options.milestones,
      pull_requests: !!options.pullRequests,
    };
    if (options.authToken) payload["auth_token"] = options.authToken;

    const res = await fetch(`${this.baseUrl}/api/v1/repos/migrate`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await this.readErrorBody(res);
      // Rate-limited migrations sometimes leave a partial repo behind: Gitea
      // creates the repo entry, clones, then fails when fetching issues/PRs.
      // Try to delete it so the user isn't left with a half-imported repo.
      let suffix = "";
      if (this.isRateLimitError(res.status, body)) {
        const outcome = await this.deleteRepo(options.owner, options.repoName);
        suffix = outcome === "deleted"
          ? ` — cleaned up partial repo ${options.owner}/${options.repoName}.`
          : outcome === "absent"
            ? "" // nothing was created, nothing to clean
            : ` — could not clean up ${options.owner}/${options.repoName}, please remove it manually.`;
      }
      throw this.makeError(res, body, suffix);
    }
    const body = await res.json() as GiteaRepo;
    return {
      fullName: body.full_name || `${options.owner}/${options.repoName}`,
      htmlUrl: body.html_url || "",
    };
  }

  // Returns "deleted" if the repo was removed, "absent" if it never existed
  // (404), and "failed" otherwise. Errors are swallowed; the caller already
  // has a primary error to surface.
  private async deleteRepo(owner: string, repo: string): Promise<"deleted" | "absent" | "failed"> {
    try {
      const url = `${this.baseUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const res = await fetch(url, { method: "DELETE", headers: this.headers() });
      if (res.ok) return "deleted";
      if (res.status === 404) return "absent";
      return "failed";
    } catch {
      return "failed";
    }
  }

  private isRateLimitError(status: number, body: GiteaError | null): boolean {
    if (status === 429) return true;
    const msg = (body?.message || "").toLowerCase();
    return /rate ?limit|abuse detection|secondary rate/i.test(msg);
  }

  private headers(): Record<string, string> {
    return {
      "Authorization": `token ${this.token}`,
      "Accept": "application/json",
    };
  }

  private async readErrorBody(res: Response): Promise<GiteaError | null> {
    try {
      return await res.json() as GiteaError;
    } catch {
      return null;
    }
  }

  private makeError(res: Response, body: GiteaError | null, suffix = ""): Error & { status?: number } {
    const base = (body && body.message) ? body.message : `HTTP ${res.status} ${res.statusText}`;
    const err: Error & { status?: number } = new Error(base + suffix);
    err.status = res.status;
    return err;
  }

  private async error(res: Response): Promise<Error & { status?: number }> {
    return this.makeError(res, await this.readErrorBody(res));
  }
}

// Type-check the static surface against BackendClass.
const _: BackendClass = GiteaBackend;
void _;

registry.registerBackend(GiteaBackend);

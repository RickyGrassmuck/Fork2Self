import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const RESERVED = new Set([
  "explore", "issues", "pulls", "user", "org", "api", "settings",
  "login", "logout", "signup", "register", "search", "admin",
  "raw", "attachments", "metrics", "help", "-",
]);

// Gogs's API exposes issues/labels/milestones; PRs, wiki, and releases
// aren't supported by Gitea's "gogs" downloader, so they're off here.
const CAPS: Capabilities = {
  mirror: true, private: true, wiki: false,
  issues: true, labels: true, pullRequests: false,
  releases: false, milestones: true,
};

// Gogs is almost always self-hosted; "try.gogs.io" is the project's demo
// instance. Other deployments need to be added via the custom-host map.
export class GogsSource {
  static readonly id = "gogs";
  static readonly label = "Gogs";
  static readonly giteaService = "gogs";
  static readonly hostnames: readonly string[] = ["try.gogs.io"];
  static readonly capabilities: Capabilities = CAPS;

  static matchesHost(host: string): boolean {
    return this.hostnames.includes(host);
  }

  static parsePath(url: URL, host: string): Repo | null {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repoRaw] = parts as [string, string];
    if (RESERVED.has(owner.toLowerCase())) return null;
    const repo = repoRaw.replace(/\.git$/, "");
    return {
      owner, repo,
      cloneUrl: `https://${host}/${owner}/${repo}`,
      htmlUrl: `https://${host}/${owner}/${repo}`,
    };
  }

  // Gogs accepts the access token as the Basic-auth username, same as Gitea.
  static authedCloneUrl(repo: Repo, token: string | null | undefined): string {
    if (!token) return repo.cloneUrl;
    const u = new URL(repo.cloneUrl);
    u.username = token;
    return u.toString();
  }
}

const _: SourceClass = GogsSource;
void _;

registry.registerSource(GogsSource);

import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const RESERVED = new Set([
  "assets", "avatars", "explore", "issues", "pulls", "notifications",
  "user", "org", "repo", "swagger", "api", "attachments", "metrics",
  "-", "dashboard", "milestones", "login", "logout", "signup", "register",
  "users", "admin", "settings", "search", "favicon.ico", "manifest.json",
  "robots.txt", "ghost", "help",
]);

const CAPS: Capabilities = {
  mirror: true, private: true, wiki: true,
  issues: true, labels: true, pullRequests: true,
  releases: true, milestones: true,
};

export class GiteaSource {
  static readonly id = "gitea";
  static readonly label = "Gitea / Forgejo";
  static readonly giteaService = "gitea";
  static readonly hostnames: readonly string[] = ["codeberg.org", "gitea.com"];
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

  // Gitea/Forgejo accept the access token as the Basic-auth username.
  static authedCloneUrl(repo: Repo, token: string | null | undefined): string {
    if (!token) return repo.cloneUrl;
    const u = new URL(repo.cloneUrl);
    u.username = token;
    return u.toString();
  }
}

const _: SourceClass = GiteaSource;
void _;

registry.registerSource(GiteaSource);

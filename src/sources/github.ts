import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const RESERVED = new Set([
  "settings", "marketplace", "topics", "trending", "collections", "events",
  "issues", "pulls", "notifications", "new", "organizations", "orgs", "login",
  "logout", "join", "pricing", "features", "enterprise", "about", "contact",
  "site", "security", "apps", "sponsors", "search", "explore", "codespaces",
  "dashboard", "stars", "watching", "integrations", "readme", "assets",
  "customer-stories", "team", "premium-support", "case-studies",
  "open-source", "solutions", "resources", "nonprofit", "social-impact",
  "discussions", "advisories", "github-copilot", "copilot",
]);

const CAPS: Capabilities = {
  mirror: true, private: true, wiki: true,
  issues: true, labels: true, pullRequests: true,
  releases: true, milestones: true,
};

export class GithubSource {
  static readonly id = "github";
  static readonly label = "GitHub";
  static readonly giteaService = "github";
  static readonly hostnames: readonly string[] = ["github.com"];
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

  // GitHub PATs accept oauth2:<token> via HTTPS Basic; matches GitLab style
  // for consistency.
  static authedCloneUrl(repo: Repo, token: string | null | undefined): string {
    if (!token) return repo.cloneUrl;
    const u = new URL(repo.cloneUrl);
    u.username = "oauth2";
    u.password = token;
    return u.toString();
  }
}

// Type-check the surface against the interface.
const _: SourceClass = GithubSource;
void _;

registry.registerSource(GithubSource);

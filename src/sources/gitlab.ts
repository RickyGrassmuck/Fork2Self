import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const RESERVED = new Set([
  "dashboard", "explore", "help", "users", "admin", "groups", "projects",
  "profile", "search", "404", "-", "oauth", "unsubscribes", "import",
  "snippets", "public", "abuse_reports", "v2", "uploads", "assets",
  "operations", "jwt", "api", "favicon.ico",
]);

const CAPS: Capabilities = {
  mirror: true, private: true, wiki: true,
  issues: true, labels: true, pullRequests: true,
  releases: true, milestones: true,
};

export class GitlabSource {
  static readonly id = "gitlab";
  static readonly label = "GitLab";
  static readonly giteaService = "gitlab";
  static readonly hostnames: readonly string[] = ["gitlab.com"];
  static readonly capabilities: Capabilities = CAPS;

  static matchesHost(host: string): boolean {
    return this.hostnames.includes(host);
  }

  static parsePath(url: URL, host: string): Repo | null {
    // Strip GitLab's "/-/..." route marker (e.g. /-/blob, /-/issues, /-/tree)
    let pathname = url.pathname;
    const dashIdx = pathname.indexOf("/-/");
    if (dashIdx >= 0) pathname = pathname.slice(0, dashIdx);
    let parts = pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    if (RESERVED.has(parts[0]!.toLowerCase())) return null;

    // Last segment is the project; everything before is the namespace
    // (which can contain subgroups: group/subgroup/project).
    const last = parts[parts.length - 1]!.replace(/\.git$/, "");
    parts = parts.slice(0, -1).concat([last]);
    const repo = parts[parts.length - 1]!;
    const owner = parts.slice(0, -1).join("/");
    return {
      owner, repo,
      cloneUrl: `https://${host}/${owner}/${repo}.git`,
      htmlUrl: `https://${host}/${owner}/${repo}`,
    };
  }

  // GitLab PATs are used as oauth2:<token> via HTTPS Basic.
  static authedCloneUrl(repo: Repo, token: string | null | undefined): string {
    if (!token) return repo.cloneUrl;
    const u = new URL(repo.cloneUrl);
    u.username = "oauth2";
    u.password = token;
    return u.toString();
  }
}

const _: SourceClass = GitlabSource;
void _;

registry.registerSource(GitlabSource);

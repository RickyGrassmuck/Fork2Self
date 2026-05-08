import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

// OneDev URLs are project-shaped, not owner/repo-shaped: a project lives at
// /projects/<path>, and the path itself can be hierarchical
// (/projects/parent/child). The clone URL drops the /projects prefix —
// `git clone https://server/<path>` — so we record that as cloneUrl and use
// the last path segment as the displayed repo name.
const RESERVED = new Set([
  "issues", "builds", "pull-requests", "agents", "my", "users",
  "groups", "login", "logout", "signup", "all-issues", "all-builds",
  "iterations", "packages", "feed", "sso", "administration",
]);

// Gitea's onedev downloader supports issues, labels, milestones, and PRs.
// Wiki and releases aren't covered.
const CAPS: Capabilities = {
  mirror: true, private: true, wiki: false,
  issues: true, labels: true, pullRequests: true,
  releases: false, milestones: true,
};

export class OneDevSource {
  static readonly id = "onedev";
  static readonly label = "OneDev";
  static readonly giteaService = "onedev";
  // OneDev's public demo instance; other deployments need a custom-host map.
  static readonly hostnames: readonly string[] = ["code.onedev.io"];
  static readonly capabilities: Capabilities = CAPS;

  static matchesHost(host: string): boolean {
    return this.hostnames.includes(host);
  }

  static parsePath(url: URL, host: string): Repo | null {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    // Strip /projects/ prefix when present; older OneDev URLs may already be
    // bare paths.
    const projectParts = parts[0]?.toLowerCase() === "projects"
      ? parts.slice(1)
      : parts;
    if (projectParts.length === 0) return null;
    if (RESERVED.has(projectParts[0]!.toLowerCase())) return null;

    // Drop trailing UI segments (e.g. /projects/foo/~code, /projects/foo/issues).
    const cleanParts = projectParts.filter((p) => !p.startsWith("~"));
    const stopIdx = cleanParts.findIndex((p) => RESERVED.has(p.toLowerCase()));
    const projectPath = (stopIdx >= 0 ? cleanParts.slice(0, stopIdx) : cleanParts)
      .join("/");
    if (!projectPath) return null;

    const segs = projectPath.split("/");
    const repo = segs[segs.length - 1]!.replace(/\.git$/, "");
    const owner = segs.slice(0, -1).join("/");

    const base = `https://${host}/${projectPath.replace(/\.git$/, "")}`;
    return {
      owner,
      repo,
      cloneUrl: base,
      htmlUrl: `https://${host}/projects/${projectPath.replace(/\.git$/, "")}`,
    };
  }

  // OneDev requires a non-empty username alongside the access token; "git"
  // is the conventional placeholder.
  static authedCloneUrl(repo: Repo, token: string | null | undefined): string {
    if (!token) return repo.cloneUrl;
    const u = new URL(repo.cloneUrl);
    u.username = "git";
    u.password = token;
    return u.toString();
  }
}

const _: SourceClass = OneDevSource;
void _;

registry.registerSource(OneDevSource);

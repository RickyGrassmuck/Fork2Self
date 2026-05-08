import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const CAPS: Capabilities = {
  mirror: true, private: true, wiki: false,
  issues: false, labels: false, pullRequests: false,
  releases: false, milestones: false,
};

// Generic Git fallback. Never auto-matches by hostname; only used when a
// hostname is explicitly mapped to "git" in the custom source map.
export class GenericGitSource {
  static readonly id = "git";
  static readonly label = "Generic Git URL";
  static readonly giteaService = "git";
  static readonly hostnames: readonly string[] = [];
  static readonly capabilities: Capabilities = CAPS;

  static matchesHost(_host: string): boolean { return false; }

  static parsePath(url: URL, host: string): Repo | null {
    const cleanPath = url.pathname.replace(/\.git$/, "").replace(/\/$/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const repo = parts[parts.length - 1]!;
    const owner = parts.slice(0, -1).join("/");
    const baseUrl = `${url.protocol}//${host}${cleanPath}`;
    return {
      owner, repo,
      cloneUrl: `${baseUrl}.git`,
      htmlUrl: baseUrl,
    };
  }

  // Best-effort: embed the token as the Basic-auth username, which works
  // for most token-as-user hosts. Hosts requiring username+password aren't
  // covered.
  static authedCloneUrl(repo: Repo, token: string | null | undefined): string {
    if (!token) return repo.cloneUrl;
    const u = new URL(repo.cloneUrl);
    u.username = token;
    return u.toString();
  }
}

const _: SourceClass = GenericGitSource;
void _;

registry.registerSource(GenericGitSource);

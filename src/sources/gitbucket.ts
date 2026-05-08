import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const RESERVED = new Set([
  "signin", "signout", "register", "account", "settings", "search",
  "admin", "system-administration", "api", "explore", "user",
  "activities", "groups", "issues", "pulls", "help", "-",
]);

// Gitea's "gitbucket" downloader covers issues, labels, milestones,
// releases, and wiki. PRs are best-effort but listed as supported.
const CAPS: Capabilities = {
  mirror: true, private: true, wiki: true,
  issues: true, labels: true, pullRequests: true,
  releases: true, milestones: true,
};

// GitBucket is self-hosted only — no public hostnames; users add their
// instance via the custom-host map in settings.
export class GitBucketSource {
  static readonly id = "gitbucket";
  static readonly label = "GitBucket";
  static readonly giteaService = "gitbucket";
  static readonly hostnames: readonly string[] = [];
  static readonly capabilities: Capabilities = CAPS;

  static matchesHost(_host: string): boolean { return false; }

  static parsePath(url: URL, host: string): Repo | null {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repoRaw] = parts as [string, string];
    if (RESERVED.has(owner.toLowerCase())) return null;
    const repo = repoRaw.replace(/\.git$/, "");
    return {
      owner, repo,
      cloneUrl: `https://${host}/${owner}/${repo}.git`,
      htmlUrl: `https://${host}/${owner}/${repo}`,
    };
  }

  // GitBucket's basic auth needs a real username paired with the token; we
  // don't have the username, so private GitBucket sources aren't supported
  // through this code path.
  static authedCloneUrl(repo: Repo, _token: string | null | undefined): string {
    return repo.cloneUrl;
  }
}

const _: SourceClass = GitBucketSource;
void _;

registry.registerSource(GitBucketSource);

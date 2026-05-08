import { registry } from "../core.js";
import type { Capabilities, Repo, SourceClass } from "../types.js";

const RESERVED = new Set([
  "account", "dashboard", "workspaces", "snippets", "explore",
  "search", "support", "blog", "product", "marketplace", "site",
  "repo", "atlassian", "user", "settings", "-",
]);

// Bitbucket Cloud. Gitea's importer has no service value for BB Cloud, so we
// use service=git (code-only). Capabilities reflect that.
const CAPS: Capabilities = {
  mirror: true, private: true, wiki: false,
  issues: false, labels: false, pullRequests: false,
  releases: false, milestones: false,
};

export class BitbucketSource {
  static readonly id = "bitbucket";
  static readonly label = "Bitbucket Cloud";
  static readonly giteaService = "git";
  static readonly hostnames: readonly string[] = ["bitbucket.org"];
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
      cloneUrl: `https://${host}/${owner}/${repo}.git`,
      htmlUrl: `https://${host}/${owner}/${repo}`,
    };
  }

  // Bitbucket Cloud app passwords need <username>:<app-password>, so a
  // single token isn't enough. Return the URL unchanged — private Bitbucket
  // sources aren't supported through this path.
  static authedCloneUrl(repo: Repo, _token: string | null | undefined): string {
    return repo.cloneUrl;
  }
}

const _: SourceClass = BitbucketSource;
void _;

registry.registerSource(BitbucketSource);

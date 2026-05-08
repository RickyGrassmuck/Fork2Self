// Shape of a parsed source repo, regardless of platform.
export interface Repo {
  owner: string;
  repo: string;
  cloneUrl: string;
  htmlUrl: string;
}

export interface Detection {
  sourceId: string;
  repo: Repo;
}

// Capability flags shared by Source and Backend classes.
// Effective UI capability = backend.capabilities[X] && source.capabilities[X].
export interface Capabilities {
  mirror: boolean;
  private: boolean;
  wiki: boolean;
  labels: boolean;
  issues: boolean;
  pullRequests: boolean;
  releases: boolean;
  milestones: boolean;
}

export const CAPABILITY_KEYS = [
  "mirror", "private", "wiki", "labels", "issues",
  "pullRequests", "releases", "milestones",
] as const satisfies readonly (keyof Capabilities)[];

export const CONTENT_CAPABILITY_KEYS = [
  "wiki", "labels", "issues", "pullRequests", "releases", "milestones",
] as const satisfies readonly (keyof Capabilities)[];

// Per-backend stored config — destination URL, auth, defaults for new forks.
export interface BackendDefaults {
  private: boolean;
  mirror: boolean;
  wiki: boolean;
  issues: boolean;
  labels: boolean;
  pullRequests: boolean;
  releases: boolean;
  milestones: boolean;
}

export interface BackendConfig {
  baseUrl: string;
  token: string;
  defaultOwner: string;
  defaults: BackendDefaults;
}

// A single configured destination — name + backend type + connection.
// Users can have multiple destinations, including multiple of the same
// backend type (e.g., two Gitea instances).
export interface Destination {
  id: string;
  name: string;
  backendId: string;
  config: BackendConfig;
}

// Top-level extension config — what loadConfig() returns.
export interface AppConfig {
  destinations: Destination[];
  defaultDestinationId: string | null;
  openAfterFork: boolean;
  customSourceHosts: Record<string, string>;
  sourceTokens: Record<string, string>;
}

// Options threaded from the popup/context-menu to the backend.
export interface MigrateOptions {
  owner: string;
  repoName: string;
  description: string;
  private: boolean;
  mirror: boolean;
  wiki: boolean;
  issues: boolean;
  labels: boolean;
  pullRequests: boolean;
  releases: boolean;
  milestones: boolean;
  giteaService: string;
  sourceId: string | null;
  sourceLabel: string | null;
  authToken?: string;
}

export interface MigrateOverrides {
  owner?: string;
  repoName?: string;
  description?: string;
  private?: boolean;
  mirror?: boolean;
  wiki?: boolean;
  issues?: boolean;
  labels?: boolean;
  pullRequests?: boolean;
  releases?: boolean;
  milestones?: boolean;
}

export interface MigrateResult {
  fullName: string;
  htmlUrl: string;
}

export interface UserInfo {
  login: string;
  displayName: string;
  htmlUrl: string;
}

// Source class — every source registers a class with these statics.
export interface SourceClass {
  readonly id: string;
  readonly label: string;
  readonly giteaService: string;
  readonly hostnames: readonly string[];
  readonly capabilities: Capabilities;
  matchesHost(host: string): boolean;
  parsePath(url: URL, host: string): Repo | null;
  authedCloneUrl(repo: Repo, token: string | null | undefined): string;
}

// Backend class shape — constructor + static metadata.
export interface BackendInstance {
  whoami(): Promise<UserInfo>;
  migrate(source: Repo, options: MigrateOptions): Promise<MigrateResult>;
  deleteRepo(owner: string, repo: string): Promise<DeleteOutcome>;
}

export type DeleteOutcome = "deleted" | "absent" | "failed";

export interface BackendClass {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tokenHelp: string;
  readonly capabilities: Capabilities;
  new (config: BackendConfig): BackendInstance;
}

// Persisted migration record — written from the background, read by the
// popup history tab.
export interface MigrationRecord {
  id: string;
  startedAt: number;
  endedAt?: number;
  status: "pending" | "success" | "failed";
  error?: string;
  // Set when the destination repo has been removed — either by auto-cleanup
  // after a failure, or by a later manual "Delete repo" action. When unset
  // on a failed record, the popup offers a manual cleanup button.
  cleanedUp?: boolean;
  source: {
    id: string;
    label: string;
    owner: string;
    repo: string;
    htmlUrl: string;
  };
  destination: {
    destinationId: string;
    destinationName: string;
    backendId: string;
    backendLabel: string;
    owner: string;
    repoName: string;
    htmlUrl?: string;
    fullName?: string;
  };
}

// Runtime message contracts.
export interface ForkRequest {
  type: "fork";
  sourceId: string;
  destinationId: string;
  repo: Repo;
  overrides: MigrateOverrides;
}

export type ForkResponse =
  | { ok: true; result: MigrateResult }
  | { ok: false; error: string; status?: number };

export interface DeleteRepoRequest {
  type: "deleteRepo";
  migrationId: string;
}

export type DeleteRepoResponse =
  | { ok: true; outcome: DeleteOutcome }
  | { ok: false; error: string };

# Fork2Self

A Firefox extension that adds a one-click "fork" action to GitHub, GitLab,
Gitea/Forgejo, and Bitbucket Cloud pages. Forks land in a self-hosted Git
instance you control.

Useful when you want a personal mirror of a public repo on your own
infrastructure — for offline access, immutable backups, internal CI, or just
because you'd rather host it yourself.

> **Status: beta.** This extension is functional and in active use, but
> rough edges are expected. Migrations can fail in surprising ways
> depending on the destination forge's version, the source repo's quirks,
> and rate limits at either end. Configuration and storage formats may
> still change between versions without a migration path. Please report
> issues on [the GitHub tracker](https://github.com/RickyGrassmuck/Fork2Self/issues)
> with the error message and the source/destination platform versions
> involved.

## Features

- **One-click forking** from the toolbar popup or the right-click context
  menu.
- **Multiple destinations.** Configure several self-hosted instances and pick
  per-fork; one is the default for one-click flows.
- **Mirror or snapshot.** Optional pull-mirror (auto-sync from source) on
  backends that support it.
- **Optional content migration.** Wiki, issues, labels, pull requests,
  releases, milestones — toggled by what the source and destination both
  support.
- **Private source repos.** Per-source-host personal access tokens used
  during clone.
- **Custom self-hosted source hostnames.** Map an internal hostname to
  GitHub/GitLab/Gitea so the popup and context menu work on it.

## Supported sources

| Source            | Code | Wiki | Issues | PRs | Labels | Releases | Milestones |
|-------------------|:----:|:----:|:------:|:---:|:------:|:--------:|:----------:|
| GitHub            |  ✓   |  ✓   |   ✓    |  ✓  |   ✓    |    ✓     |     ✓      |
| GitLab            |  ✓   |  ✓   |   ✓    |  ✓  |   ✓    |    ✓     |     ✓      |
| Gitea / Forgejo   |  ✓   |  ✓   |   ✓    |  ✓  |   ✓    |    ✓     |     ✓      |
| Gogs              |  ✓   |      |   ✓    |     |   ✓    |          |     ✓      |
| OneDev            |  ✓   |      |   ✓    |  ✓  |   ✓    |          |     ✓      |
| GitBucket         |  ✓   |  ✓   |   ✓    |  ✓  |   ✓    |    ✓     |     ✓      |
| Bitbucket Cloud   |  ✓   |      |        |     |        |          |            |
| Generic Git URL   |  ✓   |      |        |     |        |          |            |

(Bitbucket and Generic Git URLs are code-only via Gitea's `service=git`
importer. Gogs, OneDev, and GitBucket use Gitea's dedicated downloaders
and require a Gitea/Forgejo destination recent enough to ship them — Gitea
1.16+ for OneDev, 1.20+ for GitBucket.)

## Supported destinations

| Destination       | Notes                                                            |
|-------------------|------------------------------------------------------------------|
| Gitea / Forgejo   | Full content migration via `POST /api/v1/repos/migrate`.         |
| GitLab CE/EE      | Code-only via `import_url`. Pull-mirror is GitLab EE only.       |

GitLab's full content migration (issues, PRs, etc.) requires its dedicated
GitHub importer plus a *GitHub* PAT, which isn't covered by this extension.

## Install

### From an XPI

1. Download `fork2self-<version>.xpi` (built via the workflow or
   `npm run package`).
2. In Firefox, open `about:addons` → gear icon → *Install Add-on From
   File…* → pick the XPI.

Firefox stable requires signed extensions for permanent install. For local
testing without signing, use `about:debugging` → *This Firefox* → *Load
Temporary Add-on…* and pick `dist/manifest.json`.

### Setup

On first install the welcome wizard opens automatically. It walks through:

1. Picking your destination platform (Gitea/Forgejo or GitLab).
2. Entering the base URL and a personal access token, then testing the
   connection.
3. (Optional) Adding tokens for private source repos.

You can revisit any of these later from the extension's settings page.

## Build

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun run check       # typecheck + build
bun run watch       # rebuild on changes
```

Output lands in `dist/`. Load it as a temporary add-on via
`about:debugging` for development. A clean install + build runs in well
under two seconds on a warm cache.

### Taskfile

A `Taskfile.yml` is provided for [Task](https://taskfile.dev) users. Run
`task` for the full list. Highlights:

```bash
task check       # typecheck + build
task run         # launch a temporary Firefox with the extension loaded
task package     # build + produce an unsigned XPI
task sign        # build + lint + sign via AMO (needs WEB_EXT_API_*)
task ci-build    # mirror the build.yml CI workflow locally
task ci-sign     # mirror the sign.yml CI workflow locally
task clean       # remove dist/, web-ext-artifacts/, *.xpi
```

## Package

```bash
bun run package
```

Produces `fork2self-<version>.xpi` at the repo root. Requires the `zip`
command on PATH.

## CI

Two manual-trigger Gitea Actions workflows live in `.gitea/workflows/`:

- **`build.yml`** — typechecks, builds, packages, and uploads an unsigned
  XPI as an artifact.
- **`sign.yml`** — typechecks, builds, lints with `web-ext`, then signs via
  Mozilla's AMO. Channel (`unlisted` / `listed`) is a workflow input.
  Uploads the signed XPI as an artifact.

Both are gated to `workflow_dispatch` only — no automatic runs on push or
PR. Trigger them from the Gitea Actions UI when you're ready.

### Signing secrets

The signing workflow needs two repo secrets (Settings → Actions →
Secrets):

| Secret name           | Source                                                                           |
|-----------------------|----------------------------------------------------------------------------------|
| `WEB_EXT_API_KEY`     | JWT issuer from <https://addons.mozilla.org/developers/addon/api/key/> (e.g. `user:12345:678`). |
| `WEB_EXT_API_SECRET`  | JWT secret from the same page.                                                   |

You can also sign locally with `bun run sign` if those env vars are set.
The default channel is `unlisted` (signed XPI for self-distribution, not
publicly listed on AMO).

## Homepage

A self-contained marketing page lives at `docs/index.html`. Point GitHub
Pages (or any static host) at the `docs/` directory to serve it.

## Project layout

```
src/
  background.ts       service-worker logic (context menus, fork orchestration)
  popup.ts/html/css   toolbar popup (fork form + history tab)
  options.ts/html/css full settings page
  welcome.ts/html/css first-run wizard
  core.ts             shared registry, config, helpers
  types.ts            shared interfaces
  manifest.json       extension manifest (MV3)
  backends/           destination implementations (gitea, gitlab)
  sources/            source URL parsers (github, gitlab, gitea, bitbucket, git)
  icons/              extension icon
build.ts              Bun bundler driver
scripts/package.ts    XPI packager
```

Sources and backends self-register with `core.ts`'s registry at import time.
Adding a new platform is a single file in the appropriate folder plus an
import in its `index.ts`.

## Permissions

| Permission                      | Why                                                              |
|---------------------------------|------------------------------------------------------------------|
| `storage`                       | Persist destinations, tokens, and migration history locally.     |
| `contextMenus`                  | "Fork to…" right-click entries.                                  |
| `notifications`                 | Toast on fork start / success / failure.                         |
| `activeTab`                     | Read the URL of the tab the user clicks the action on.           |
| `optional_host_permissions: *`  | Granted per-host on demand when you add or test a destination.   |

`host_permissions` is empty by default — the extension only gains access to
specific destination origins after you grant them in the settings flow.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

#!/usr/bin/env bun
// Bump the project version in every place it's tracked.
//
// Usage: bun run bump <new-version>
//
// Updates package.json and src/manifest.json. The two must stay in sync —
// package.json drives CI (XPI filename, version stamps); src/manifest.json
// is the version Firefox/AMO actually record.

import { readFile, writeFile } from "node:fs/promises";

interface VersionedFile {
  path: string;
}

const FILES: VersionedFile[] = [
  { path: "package.json" },
  { path: "src/manifest.json" },
];

// Mozilla's extension manifest accepts 1–4 numeric dot-separated parts.
// We constrain to the 3-part semver shape used everywhere else in the repo.
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// Match `"version": "X.Y.Z"` only at top-level positions where it
// appears as a JSON key (preceded by `{` or `,` and whitespace). This
// avoids matching the substring inside `"manifest_version": 3`, which
// has a numeric value anyway, but the anchoring also rules out any
// future field whose name contains "version".
const VERSION_FIELD_RE = /(^|[{,]\s*)"version"\s*:\s*"[^"]+"/m;

function fail(msg: string): never {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const newVersion = process.argv[2];
  if (!newVersion) {
    fail("usage: bun run bump <new-version>  (example: bun run bump 0.7.0)");
  }
  if (!VERSION_RE.test(newVersion)) {
    fail(`invalid version "${newVersion}" — expected MAJOR.MINOR.PATCH`);
  }

  const updates: Array<{ path: string; from: string; to: string }> = [];

  for (const file of FILES) {
    const content = await readFile(file.path, "utf8");
    const match = content.match(VERSION_FIELD_RE);
    if (!match) fail(`could not find a top-level "version" field in ${file.path}`);
    const current = match[0].match(/"version"\s*:\s*"([^"]+)"/)![1]!;
    if (current === newVersion) {
      console.log(`${file.path}: already at ${newVersion}`);
      continue;
    }
    const updated = content.replace(
      VERSION_FIELD_RE,
      (_, prefix: string) => `${prefix}"version": "${newVersion}"`,
    );
    await writeFile(file.path, updated);
    updates.push({ path: file.path, from: current, to: newVersion });
  }

  if (updates.length === 0) {
    console.log(`already at ${newVersion}; nothing to do.`);
    return;
  }
  console.log("updated:");
  for (const u of updates) console.log(`  ${u.path}: ${u.from} → ${u.to}`);
}

await main();

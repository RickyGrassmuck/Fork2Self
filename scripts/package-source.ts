#!/usr/bin/env bun
// Package the project source as a ZIP for AMO listed-channel submission.
//
// AMO requires source disclosure when the bundled output is concatenated
// or machine-generated, which Bun's bundler produces. We use `git archive`
// so the archive is a deterministic snapshot of tracked files at HEAD —
// reviewers running `bun install && bun run build` reproduce the XPI
// exactly. Uncommitted changes are NOT included; that's intentional.

import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const OUTPUT = "web-ext-artifacts/source.zip";

await mkdir("web-ext-artifacts", { recursive: true });

const result = spawnSync(
  "git",
  ["archive", "--format=zip", `--output=${OUTPUT}`, "HEAD"],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  console.error(`package-source: git archive failed (exit ${result.status})`);
  process.exit(result.status ?? 1);
}

console.log(`source archive → ${OUTPUT}`);

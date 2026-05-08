import { copyFile, mkdir, rm } from "node:fs/promises";
import { watch as fsWatch } from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

const SRC = "src";
const OUT = "dist";

const ENTRIES = [
  "src/background.ts",
  "src/popup.ts",
  "src/options.ts",
  "src/welcome.ts",
];

const STATIC_FILES = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "options.html",
  "options.css",
  "welcome.html",
  "welcome.css",
  "icons/icon.svg",
];

async function copyStatic(): Promise<void> {
  await Promise.all(STATIC_FILES.map(async (rel) => {
    const from = path.join(SRC, rel);
    const to = path.join(OUT, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }));
}

async function bundle(): Promise<void> {
  const result = await Bun.build({
    entrypoints: ENTRIES,
    outdir: OUT,
    target: "browser",
    format: "iife",
    sourcemap: "linked",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    if (!watch) process.exit(1);
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copyStatic();
await bundle();
console.log(`built → ${OUT}/`);

if (watch) {
  console.log("watching for changes — Ctrl-C to stop");
  let pending: ReturnType<typeof setTimeout> | null = null;
  fsWatch(SRC, { recursive: true }, () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      await copyStatic();
      await bundle();
      console.log(`rebuilt → ${OUT}/`);
    }, 50);
  });
}

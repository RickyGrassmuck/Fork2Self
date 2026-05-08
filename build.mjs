import * as esbuild from "esbuild";
import { copyFile, mkdir, rm, readdir } from "node:fs/promises";
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

async function copyStatic() {
  for (const rel of STATIC_FILES) {
    const from = path.join(SRC, rel);
    const to = path.join(OUT, rel);
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

async function clean() {
  await rm(OUT, { recursive: true, force: true });
}

await clean();
await mkdir(OUT, { recursive: true });
await copyStatic();

/** @type {import("esbuild").BuildOptions} */
const buildOptions = {
  entryPoints: ENTRIES,
  bundle: true,
  outdir: OUT,
  format: "iife",
  target: ["firefox115"],
  sourcemap: true,
  logLevel: "info",
  legalComments: "none",
};

if (watch) {
  // Re-copy static files when they change.
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [{
      name: "copy-static",
      setup(build) {
        build.onEnd(async () => {
          await copyStatic();
        });
      },
    }],
  });
  await ctx.watch();
  console.log("watching for changes — Ctrl-C to stop");
} else {
  await esbuild.build(buildOptions);
  console.log(`built → ${OUT}/`);
}

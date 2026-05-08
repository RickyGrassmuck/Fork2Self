// Package the built extension as an XPI (zip with manifest at the root).
// Runs the build first, then shells out to `zip`. Fails clearly if `zip`
// isn't on PATH.

import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const xpiName = `fork2self-${version}.xpi`;
const xpiPath = path.join(ROOT, xpiName);

await run("bun", ["run", "build"], { cwd: ROOT });

if (!(await exists(DIST))) {
  throw new Error(`build did not produce ${DIST}`);
}
await rm(xpiPath, { force: true });

try {
  await run("zip", ["-r", "-FS", xpiPath, "."], { cwd: DIST });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ENOENT") {
    throw new Error("`zip` is required to package the extension. Install it (e.g. `apt install zip`, `brew install zip`).");
  }
  throw err;
}

console.log(`packaged → ${xpiName}`);

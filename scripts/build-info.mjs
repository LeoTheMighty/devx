// Embed git-SHA build provenance into dist/ (pin104).
//
// Writes `dist/build-info.json` `{ sha, builtAt }` from `git rev-parse
// --short HEAD`. Wired into `npm run build`; the version surface
// (src/lib/version.ts) composes `<semver>+<sha>` when the file exists and
// falls back to plain semver when it doesn't — so tarball installs without
// a .git dir, and dev runs before any build, degrade gracefully. dist/ is
// gitignored, so the file is never tracked.
//
// Spec: dev/dev-pin104-2026-07-14T12:03-install-global-sha-docs.md

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// b931a1: `npm run build:swap` compiles into a staging dir (`dist.next`) and
// swaps it in, so a peer session invoking `devx` mid-rebuild never loads a
// half-emitted tree. The provenance embed has to follow the compile to the
// same target, or the swapped-in build carries no sha and the staleness
// warning can never fire on it. Unset = the plain in-place `npm run build`.
const outDirName = process.env.DEVX_BUILD_OUTDIR || "dist";

// tsc emits dist/cli.js mode 644; the package bin points straight at it, and
// `npm i -g .` does not restore the exec bit (debug-e3f1c2 live repro). Set
// it here — this script runs on every build, git checkout or not. A missing
// dist/cli.js means tsc failed to emit the entrypoint: fail loud.
chmodSync(join(repoRoot, outDirName, "cli.js"), 0o755);

const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (r.status !== 0 || !/^[0-9a-f]{7,}$/.test(r.stdout.trim())) {
  // Not a git checkout (tarball install) or git unavailable — provenance is
  // simply absent; the version surface reports plain semver. Never fail the
  // build over it — but DO remove any stale embed from a previous build so
  // the version can't report a sha this build didn't come from.
  rmSync(join(repoRoot, outDirName, "build-info.json"), { force: true });
  process.stderr.write(
    "build-info: no git SHA available — skipping provenance embed (plain semver)\n",
  );
  process.exit(0);
}

const info = {
  sha: r.stdout.trim(),
  builtAt: new Date().toISOString(),
};

const distDir = join(repoRoot, outDirName);
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
process.stdout.write(`build-info: ${info.sha} embedded in ${outDirName}/build-info.json\n`);

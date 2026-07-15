// debug-e3f1c2 — dist/cli.js must carry the exec bit post-build.
//
// tsc emits mode 644 and `npm i -g .` does not restore +x on the bin target,
// so `devx` failed with "permission denied" after `npm run install:global`.
// scripts/build-info.mjs (part of `npm run build`) now chmods dist/cli.js to
// 755; this pins that contract. Skipped when dist hasn't been built — `npm
// test` runs the build before vitest, so CI always exercises it.
//
// Spec: debug/debug-e3f1c2-2026-07-15T13:05-install-global-exec-bit.md

import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = resolve(repoRoot, "dist", "cli.js");

describe("debug-e3f1c2 — dist/cli.js exec bit", () => {
  it.skipIf(!existsSync(distEntry))(
    "dist/cli.js is executable by owner, group, and other after a build",
    () => {
      const mode = statSync(distEntry).mode;
      expect(mode & 0o111, `dist/cli.js mode is 0${(mode & 0o777).toString(8)}`).toBe(0o111);
    },
  );
});

// E-6 (P2): install docs reference only paths and flows that exist.
// RED until dst101 merges. Runnable standalone: `npx tsx <this file>`.
// Phantom checks are enumerated (not inferred) so the eval stays
// deterministic: known-dead names must be absent, referenced dirs must
// exist, and the real install flow must be documented.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const setup = readFileSync(join(repoRoot, "docs", "SETUP.md"), "utf8");
const install = readFileSync(join(repoRoot, "INSTALL.md"), "utf8");

// 1. Known-phantom names must not appear.
for (const phantom of ["install.sh", "devx-triage"]) {
  if (setup.includes(phantom)) {
    failures.push(`docs/SETUP.md still references phantom '${phantom}'`);
  }
}

// 2. If docs reference a skills/ dir, it must exist in the repo.
if (/`?skills\/`?/.test(setup) && !existsSync(join(repoRoot, "skills"))) {
  failures.push("docs/SETUP.md references skills/ but the directory does not exist");
}

// 3. The documented install flow must be the one that works today:
//    local global install, not a registry install of an unpublished pkg.
if (!install.includes("install:global")) {
  failures.push(
    "INSTALL.md does not document `npm run install:global` (the only working install path while the package is private)",
  );
}
if (!install.includes("npm link")) {
  failures.push("INSTALL.md carries no npm-link warning");
}

if (failures.length > 0) {
  console.error("E-6 RED — install docs describe things that do not exist:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-6 GREEN — install docs match reality.");

// E-2 (P0): repo commands cannot silently diverge from packaged skills.
// RED until skl101 merges. Runnable standalone: `npx tsx <this file>`.
// Asserts (a) skills/ mirror exists and is byte-identical to
// .claude/commands/, and (b) the drift guard test is wired into the
// default suite (its file exists under test/ — vitest picks it up).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const NAMES = ["devx.md", "devx-plan.md", "devx-interview.md"];

for (const name of NAMES) {
  const live = join(repoRoot, ".claude", "commands", name);
  const shipped = join(repoRoot, "skills", name);
  if (!existsSync(live)) {
    failures.push(`.claude/commands/${name} missing (canonical side)`);
    continue;
  }
  if (!existsSync(shipped)) {
    failures.push(`skills/${name} missing (shipped mirror side)`);
    continue;
  }
  if (readFileSync(live, "utf8") !== readFileSync(shipped, "utf8")) {
    failures.push(`skills/${name} diverges from .claude/commands/${name}`);
  }
}

if (!existsSync(join(repoRoot, "test", "skills-sync.test.ts"))) {
  failures.push("test/skills-sync.test.ts missing — divergence would not fail npm test");
}

if (failures.length > 0) {
  console.error("E-2 RED — skills mirror is absent or unguarded:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-2 GREEN — skills mirror in sync and guarded by the default suite.");

// E-1 (P0): skill bodies ship in the npm tarball. RED until skl101 merges.
// Runnable standalone: `npx tsx <this file>` — exit 0 = met.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const SKILLS = ["skills/devx.md", "skills/devx-plan.md", "skills/devx-interview.md"];

const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (r.status !== 0) {
  failures.push(`npm pack --dry-run --json exited ${r.status}: ${r.stderr.slice(0, 200)}`);
} else {
  // npm may prepend notices to stdout; the JSON array starts at the first '['.
  const start = r.stdout.indexOf("[");
  if (start === -1) {
    failures.push("npm pack --dry-run --json produced no JSON array");
  } else {
    const manifest = JSON.parse(r.stdout.slice(start)) as Array<{
      files?: Array<{ path?: string }>;
    }>;
    const paths = new Set(
      (manifest[0]?.files ?? []).map((f) => (f.path ?? "").replace(/\\/g, "/")),
    );
    for (const s of SKILLS) {
      if (!paths.has(s)) failures.push(`tarball manifest missing ${s}`);
    }
  }
}

if (failures.length > 0) {
  console.error("E-1 RED — skill bodies do not ship in the npm tarball:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-1 GREEN — 3/3 skill bodies present in the pack manifest.");

// E-5 (P1): version provenance survives the global install. RED until
// dst101 merges. Runnable standalone: `npx tsx <this file>`.
// Runs the build-info embed step, then asserts `devx --version` reports
// <semver>+<sha>. Requires `dist/` to exist (npm run build).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const embedScript = join(repoRoot, "scripts", "build-info.mjs");
if (!existsSync(embedScript)) {
  failures.push("scripts/build-info.mjs missing — nothing embeds the git SHA at build time");
} else {
  const embed = spawnSync("node", [embedScript], { cwd: repoRoot, encoding: "utf8" });
  if (embed.status !== 0) {
    failures.push(`build-info embed exited ${embed.status}: ${embed.stderr.slice(0, 200)}`);
  } else {
    const r = spawnSync("node", [join(repoRoot, "dist", "cli.js"), "--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (r.status !== 0) {
      failures.push(`devx --version exited ${r.status}`);
    } else if (!/^\d+\.\d+\.\d+\+[0-9a-f]{7,}$/m.test(r.stdout.trim())) {
      failures.push(
        `devx --version output '${r.stdout.trim()}' does not match <semver>+<sha>`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("E-5 RED — version carries no build provenance:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-5 GREEN — devx --version reports <semver>+<sha>.");

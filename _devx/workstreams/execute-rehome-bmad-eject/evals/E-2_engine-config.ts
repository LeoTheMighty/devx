// E-2 (P0): the engine: config block is first-class. RED until v2x101
// merges. Runnable standalone: `npx tsx <this file>` — exit 0 = met.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const raw = readFileSync(join(repoRoot, "devx.config.yaml"), "utf8");
const config = parse(raw) as Record<string, unknown> | null;
const engine = config?.engine as Record<string, unknown> | undefined;

if (!engine || typeof engine !== "object") {
  failures.push("devx.config.yaml has no top-level engine: block");
} else {
  const root = engine.workstreams_root;
  if (typeof root !== "string" || root.trim() === "") {
    failures.push("engine.workstreams_root missing or empty");
  } else if (!existsSync(join(repoRoot, root))) {
    failures.push(`engine.workstreams_root '${root}' does not resolve to an existing directory`);
  }
  // Schema-validity proxy: the shipped JSON schema must know the key
  // (v2x101 adds it; absence = the block is squatting unvalidated).
  const schema = readFileSync(join(repoRoot, "_devx", "config-schema.json"), "utf8");
  if (!schema.includes('"engine"')) {
    failures.push("_devx/config-schema.json does not declare the engine section");
  }
}

if (failures.length > 0) {
  console.error("E-2 RED — engine config block is not first-class:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-2 GREEN — engine config block is first-class.");

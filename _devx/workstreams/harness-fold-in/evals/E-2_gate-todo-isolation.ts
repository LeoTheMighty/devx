// E-2 (P0): gates never read todo.md.
// RED until Phase 1 merges. Runnable standalone: `npx tsx <this file>`.
// Asserts (a) the static read-surface invariant — 0 references to todo in
// the gate implementation modules (provable against today's gates, pinned
// against Phase 2's gate.ts edits), and (b) the permanent 4-fixture
// byte-identity suite test/gate-todo-isolation.test.ts exists so the
// invariant fails `npm test` if it ever breaks.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const GATE_MODULES = [
  "src/commands/gate.ts",
  "src/lib/engine/gate-prd.ts",
  "src/lib/engine/gate-coverage.ts",
  "src/lib/engine/gate-evals.ts",
];

// Any mention of the todo file or the todo engine module inside gate code is
// a read-surface breach — the firewall is total, not "reads but ignores".
const BREACH_RE = /todo\.md|engine\/todo(?:\.js|\.ts)?|parseTodo|currentFocus|computeTodoDrift|trueDerivedLines/;

for (const rel of GATE_MODULES) {
  const abs = join(repoRoot, ...rel.split("/"));
  if (!existsSync(abs)) {
    failures.push(`${rel} missing — gate module set changed; update this eval + E-2`);
    continue;
  }
  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (BREACH_RE.test(line)) {
      failures.push(`${rel}:${i + 1} references todo surface: '${line.trim()}'`);
    }
  });
}

if (!existsSync(join(repoRoot, "test", "gate-todo-isolation.test.ts"))) {
  failures.push(
    "test/gate-todo-isolation.test.ts missing — the 4-fixture byte-identity + static-scan invariant is not pinned in the default suite (feature missing, T1.7)",
  );
}

if (failures.length > 0) {
  console.error("E-2 RED — gate↔todo firewall is not pinned yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-2 GREEN — gate modules are todo-free and the invariant is pinned in npm test.");

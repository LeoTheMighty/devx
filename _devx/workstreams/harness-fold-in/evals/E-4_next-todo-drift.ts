// E-4 (P1): drift detection is mechanical and advisory.
// RED until Phase 3 merges (pure computeTodoDrift lands Phase 1). Runnable
// standalone: `npx tsx <this file>`.
// Asserts (a) computeTodoDrift detects both contradiction classes —
// gate-flag and phase-pointer, either direction — from pure inputs, and
// (b) the permanent suite test/next-todo-drift.test.ts exists (it owns the
// CLI-level advisory contract: exit code unchanged, 0 file writes).

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// Gate `prd` is CHECKED in todo but its flag is false (class a); the phase-1
// pointer is UNCHECKED but its linked dev spec is done (class b).
const FIXTURE_TODO = `- [x] Stage: PRD
- [x] Gate: prd
- [ ] Stage: Design
- [ ] Gate: coverage(design)
- [ ] Stage: Plan
- [ ] Gate: coverage(plan)
- [ ] Stage: RED
- [ ] Gate: evals
- [ ] Stage: Execute
  - [ ] Phase 1: fixture phase → abc123
- [ ] Stage: Retro
- [ ] Stage: Outcome
`;

const FIXTURE_TRUTH = {
  state: {
    hash: "e4f1x0",
    stage: "executing",
    gateStatus: {
      prd_validated: false, // contradicts the checked `Gate: prd`
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    },
  },
  phaseDone: { abc123: true }, // contradicts the unchecked phase pointer
};

try {
  const todoMod = await import("../../../../src/lib/engine/todo.js");
  if (typeof todoMod.parseTodo !== "function" || typeof todoMod.computeTodoDrift !== "function") {
    failures.push("src/lib/engine/todo.ts lacks parseTodo/computeTodoDrift exports (T1.3/T1.5)");
  } else {
    const doc = todoMod.parseTodo(FIXTURE_TODO);
    const drift = todoMod.computeTodoDrift(doc, FIXTURE_TRUTH as never) as Array<{
      class: string;
      line: number;
      message: string;
    }>;
    const classes = new Set(drift.map((d) => d.class));
    if (!classes.has("gate-flag")) {
      failures.push("gate-flag contradiction (checked `Gate: prd` vs flag false) not detected");
    }
    if (!classes.has("phase-pointer")) {
      failures.push("phase-pointer contradiction (unchecked pointer vs linked spec done) not detected");
    }
    for (const d of drift) {
      if (typeof d.line !== "number" || d.line < 1) {
        failures.push(`drift entry '${d.message}' carries no 1-indexed line number`);
      }
    }
  }
} catch {
  failures.push("src/lib/engine/todo.ts missing — computeTodoDrift not implemented (feature missing, T1.5)");
}

if (!existsSync(join(repoRoot, "test", "next-todo-drift.test.ts"))) {
  failures.push(
    "test/next-todo-drift.test.ts missing — advisory contract (exit code unchanged, 0 file writes) not pinned (feature missing, T3.6)",
  );
}

if (failures.length > 0) {
  console.error("E-4 RED — todo drift detection not implemented yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-4 GREEN — both drift classes detected mechanically; advisory contract pinned.");

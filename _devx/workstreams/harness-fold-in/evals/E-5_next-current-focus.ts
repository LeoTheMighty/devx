// E-5 (P1): current focus derives from ground truth.
// RED until Phase 3 merges (pure currentFocus lands Phase 1). Runnable
// standalone: `npx tsx <this file>`.
// Asserts currentFocus roots at the frontmatter-derived stage (never the
// first unchecked checkbox): mid-intake fixture, mid-execute fixture, and
// the stale hand-checked stage-parent fixture (checkbox must not move the
// focus head). The absent-file → no-line contract is CLI-level and lives in
// the permanent suite test/next-current-focus.test.ts, whose existence is
// also asserted here.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// Mid-intake: stage=prd, free-nested intake items under Stage: PRD.
const MID_INTAKE = `- [ ] Stage: PRD
  - [x] interview the user
  - [ ] promote the evals seed
- [ ] Gate: prd
- [ ] Stage: Design
- [ ] Gate: coverage(design)
- [ ] Stage: Plan
- [ ] Gate: coverage(plan)
- [ ] Stage: RED
- [ ] Gate: evals
- [ ] Stage: Execute
- [ ] Stage: Retro
- [ ] Stage: Outcome
`;

// Mid-execute: stage=executing, phase pointers under Stage: Execute.
const MID_EXECUTE = `- [x] Stage: PRD
- [x] Gate: prd
- [x] Stage: Design
- [x] Gate: coverage(design)
- [x] Stage: Plan
- [x] Gate: coverage(plan)
- [x] Stage: RED
- [x] Gate: evals
- [ ] Stage: Execute
  - [x] Phase 1: ground layer → abc123
  - [ ] Phase 2: verdicts → def456
- [ ] Stage: Retro
- [ ] Stage: Outcome
`;

// Stale hand-check: same as mid-execute but someone hand-checked the
// Stage: Design parent AND left an unchecked free item under PRD — with
// stage=executing the focus must still come from the Execute section.
const STALE_HAND_CHECKED = `- [ ] Stage: PRD
  - [ ] a stale unchecked intake leftover
- [x] Gate: prd
- [x] Stage: Design
- [x] Gate: coverage(design)
- [x] Stage: Plan
- [x] Gate: coverage(plan)
- [x] Stage: RED
- [x] Gate: evals
- [ ] Stage: Execute
  - [ ] Phase 1: ground layer → abc123
- [ ] Stage: Retro
- [ ] Stage: Outcome
`;

try {
  const todoMod = await import("../../../../src/lib/engine/todo.js");
  if (typeof todoMod.parseTodo !== "function" || typeof todoMod.currentFocus !== "function") {
    failures.push("src/lib/engine/todo.ts lacks parseTodo/currentFocus exports (T1.3/T1.4)");
  } else {
    const focusOf = (content: string, stage: string): string | null =>
      todoMod.currentFocus(todoMod.parseTodo(content), stage as never);

    const f1 = focusOf(MID_INTAKE, "prd");
    if (f1 === null || !f1.includes("promote the evals seed")) {
      failures.push(`mid-intake focus wrong: got '${String(f1)}', wanted the first unchecked deepest item under Stage: PRD`);
    }
    const f2 = focusOf(MID_EXECUTE, "executing");
    if (f2 === null || !f2.includes("Phase 2")) {
      failures.push(`mid-execute focus wrong: got '${String(f2)}', wanted the unchecked Phase 2 pointer`);
    }
    const f3 = focusOf(STALE_HAND_CHECKED, "executing");
    if (f3 === null || !f3.includes("Phase 1")) {
      failures.push(
        `stale hand-checked fixture moved the focus head: got '${String(f3)}', wanted the Execute-section Phase 1 pointer (checkbox state must not root the walk)`,
      );
    }
  }
} catch {
  failures.push("src/lib/engine/todo.ts missing — currentFocus not implemented (feature missing, T1.4)");
}

if (!existsSync(join(repoRoot, "test", "next-current-focus.test.ts"))) {
  failures.push(
    "test/next-current-focus.test.ts missing — absent-file exit-0/no-line contract + renderer wiring not pinned (feature missing, T3.6)",
  );
}

if (failures.length > 0) {
  console.error("E-5 RED — frontmatter-rooted focus walk not implemented yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-5 GREEN — focus derives from frontmatter stage on all 3 fixtures; suite pinned.");

// Tests for pln104 — source-of-truth-precedence enforcement at planning time.
//
// pln104 is a discipline + documentation story: it documents the explicit
// override flow in `.claude/commands/devx-plan.md` Phase 6 (party-mode locks
// decision X → check against draft ACs → on conflict update epic locked
// decisions + epic status log + spec ACs + spec status log → validate-emit
// catches anything that drifts). The runtime catch mechanism already exists
// in pln103's validate-emit (check #6: locked-decision-token-missing-from-spec
// warn-severity), so what's testable here is:
//
//   1. validate-emit's warn fires when an applied Locked decision's tokens are
//      absent from the referenced spec body — i.e., step 3 of the override
//      flow ran (epic updated) but step 4 (spec rewritten) did not. This is
//      the "BEFORE override is fully applied" state.
//
//   2. The warn clears after the spec is rewritten to include the new tokens.
//      This is the "AFTER override fully applied" state.
//
//   3. The end-state fixture (epic Locked decisions + epic status-log line +
//      spec AC + spec status-log line) is structurally consistent — the test
//      asserts each artifact in the END state is in the canonical shape the
//      skill body documents.
//
//   4. `.claude/commands/devx-plan.md` Phase 6 documents every required piece
//      of the override flow. Doc-check guards against drift between the spec
//      contract and the skill body's procedure.
//
// Spec: dev/dev-pln104-2026-04-28T19:30-plan-precedence-enforcement.md
// Closes LEARN.md cross-epic pattern: `[high] [docs] Source-of-truth
// precedence rule` — making it enforced at planning time, not at /devx
// claim time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type ValidateEmitFs,
  validateEmit,
} from "../src/lib/plan/validate-emit.js";

// ---------------------------------------------------------------------------
// Fixture builder — the same in-memory fs seam used by plan-validate-emit's
// pure-fn tests. Local to this file to avoid coupling the two test suites'
// fixture shapes (this one is a tighter, override-focused fixture).
// ---------------------------------------------------------------------------

interface MemoryFs extends ValidateEmitFs {
  put(absPath: string, content: string): void;
}

function newMemoryFs(): MemoryFs {
  const files = new Map<string, string>();
  const dirs = new Map<string, Set<string>>();
  return {
    put(absPath: string, content: string): void {
      files.set(absPath, content);
      const parts = absPath.split("/").filter((s) => s.length > 0);
      for (let i = 0; i < parts.length; i++) {
        const dirAbs = i === 0 ? "/" : "/" + parts.slice(0, i).join("/");
        const child = parts[i];
        if (!dirs.has(dirAbs)) dirs.set(dirAbs, new Set());
        dirs.get(dirAbs)!.add(child);
      }
    },
    readFile(p: string): string {
      const v = files.get(p);
      if (v === undefined) throw new Error(`MemoryFs: ENOENT: ${p}`);
      return v;
    },
    exists(p: string): boolean {
      return files.has(p) || dirs.has(p);
    },
    readdir(p: string): string[] {
      return [...(dirs.get(p) ?? [])];
    },
  };
}

const REPO_ROOT = "/synth";
const EPIC_SLUG = "fixture-precedence";
const SINGLE_BRANCH_CONFIG = {
  git: { integration_branch: null, branch_prefix: "feat/" },
};

/**
 * Build a fixture epic with a Locked decision anchored on `fix101 AC bumped`,
 * referencing `not-X` as the new decision token. The spec body is configured
 * by the caller — `specMentionsNewToken` controls whether the spec contains
 * "not-X" (the AFTER state) or only "X" (the BEFORE state).
 */
function precedenceFixture(opts: {
  specMentionsNewToken: boolean;
}): { fs: MemoryFs; repoRoot: string } {
  const fs = newMemoryFs();
  const epicPath = `${REPO_ROOT}/_bmad-output/planning-artifacts/epic-${EPIC_SLUG}.md`;
  // The Locked decision flips the AC from `X` to `not-X`. Both tokens are
  // backticked — that's what activates check #6's token scanner.
  fs.put(
    epicPath,
    `# Epic — fixture-precedence

## Story list with ACs

### fix101 — first story
- [ ] AC depends on the override target.

### fixret — Retro
- [ ] Run bmad-retrospective.

## Status log

- 2026-05-05T10:00 — drafted
- 2026-05-05T10:15 — party-mode override (epic-${EPIC_SLUG}): AC \`X\` superseded by \`not-X\` per QA finding

## Party-mode refined (2026-05-05)

### Findings + decisions

**QA / Test architect.** Concern: AC \`X\` is too permissive. **Locked decision:** fix101 AC bumped — flipped from \`X\` to \`not-X\` per QA finding.

### Cross-epic locked decisions added to global list
1. **Sample.**
`,
  );
  // Spec: AC body either contains both old + new tokens (AFTER override fully
  // applied — spec was rewritten) or only the old token (BEFORE — step 4 of
  // the override flow didn't run).
  const acBody = opts.specMentionsNewToken
    ? "- [ ] AC: must reject `not-X` (formerly accepted `X`).\n"
    : "- [ ] AC: must accept `X`.\n";
  // Spec status log: the AFTER fixture also carries the override-propagation
  // status-log line documented in skill body Phase 6 step 5.4.
  const statusLogBody = opts.specMentionsNewToken
    ? `- 2026-05-05T10:00 — created
- 2026-05-05T10:15 — party-mode override: AC 'accept X' → 'reject not-X' per QA finding\n`
    : `- 2026-05-05T10:00 — created\n`;
  fs.put(
    `${REPO_ROOT}/dev/dev-fix101-2026-05-05T10:00-first.md`,
    `---
hash: fix101
type: dev
created: 2026-05-05T10:00:00-07:00
title: first story
from: _bmad-output/planning-artifacts/epic-${EPIC_SLUG}.md
status: ready
branch: feat/dev-fix101
---

## Goal
First.

## Acceptance criteria
${acBody}
## Status log

${statusLogBody}`,
  );
  fs.put(
    `${REPO_ROOT}/dev/dev-fixret-2026-05-05T10:00-retro-${EPIC_SLUG}.md`,
    `---
hash: fixret
type: dev
created: 2026-05-05T10:00:00-07:00
title: Retro
from: _bmad-output/planning-artifacts/epic-${EPIC_SLUG}.md
status: ready
blocked_by: [fix101]
branch: feat/dev-fixret
---

## Goal
Retro.
`,
  );
  fs.put(
    `${REPO_ROOT}/DEV.md`,
    `# DEV

### Epic — fixture-precedence
- [ ] \`dev/dev-fix101-2026-05-05T10:00-first.md\` — first story. Status: ready.
- [ ] \`dev/dev-fixret-2026-05-05T10:00-retro-${EPIC_SLUG}.md\` — Retro. Status: ready. Blocked-by: fix101.
`,
  );
  fs.put(
    `${REPO_ROOT}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
    `plans:
  - key: plan-fixture
    title: Fixture
    status: backlog
    epics:
      - key: epic-${EPIC_SLUG}
        title: Fixture
        status: backlog
        stories:
          - key: fix101
            title: first
            status: backlog
          - key: fixret
            title: Retro
            status: backlog
            blocked_by: [fix101]
`,
  );
  return { fs, repoRoot: REPO_ROOT };
}

// ---------------------------------------------------------------------------
// 1) Override-flow runtime catch — BEFORE state: spec hasn't been rewritten.
// ---------------------------------------------------------------------------

describe("/devx-plan Phase 6 source-of-truth precedence (pln104)", () => {
  it("validate-emit warns when locked decision references a token the spec body doesn't contain (step 3 ran, step 4 didn't)", () => {
    const { fs, repoRoot } = precedenceFixture({ specMentionsNewToken: false });
    const r = validateEmit(
      { repoRoot, epicSlug: EPIC_SLUG, config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(r.epicFound).toBe(true);
    const warns = r.issues.filter((i) => i.severity === "warn");
    const tokenWarns = warns.filter(
      (i) => i.check === "locked-decision-token-missing-from-spec",
    );
    // The Locked decision contains backticked `X` and `not-X`. The BEFORE
    // spec body contains only `X`. So the warn should fire for `not-X`.
    // Find the `not-X` warn explicitly rather than by index — validate-emit
    // doesn't promise warn ordering, and a future check that emits a second
    // warn would break an index-0 lookup.
    const notXWarn = tokenWarns.find((w) =>
      w.message.includes("'`not-X`'"),
    );
    expect(notXWarn).toBeDefined();
    // The warn's location must reference both the epic line AND the spec
    // file — the operator needs both to fix the drift.
    expect(notXWarn!.location).toMatch(/epic-fixture-precedence\.md/);
    expect(notXWarn!.location).toMatch(/dev\/dev-fix101-/);
    // Error-severity issues should be empty — the override flow's catch is
    // warn-only (semantic conflict-detection is genuinely heuristic).
    const errors = r.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("validate-emit's warn clears once the spec is rewritten to include the new locked-decision token (step 4 done)", () => {
    const { fs, repoRoot } = precedenceFixture({ specMentionsNewToken: true });
    const r = validateEmit(
      { repoRoot, epicSlug: EPIC_SLUG, config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const tokenWarns = r.issues
      .filter((i) => i.severity === "warn")
      .filter((i) => i.check === "locked-decision-token-missing-from-spec");
    // Both `X` and `not-X` now appear in the spec body. No token-missing warn.
    expect(tokenWarns).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("the AFTER fixture carries the override propagation in epic status log + spec status log + spec AC", () => {
    // Discipline-check: the END STATE shape the skill body's Phase 6 step 5
    // procedure produces. validate-emit doesn't audit status-log lines, so
    // this test asserts the structural contract directly on the fixture.
    const { fs, repoRoot } = precedenceFixture({ specMentionsNewToken: true });
    const epicBody = fs.readFile(
      `${repoRoot}/_bmad-output/planning-artifacts/epic-${EPIC_SLUG}.md`,
    );
    const specBody = fs.readFile(
      `${repoRoot}/dev/dev-fix101-2026-05-05T10:00-first.md`,
    );
    // 1. Epic file records the override in its status log per the canonical
    //    `party-mode override (epic-<slug>): ... superseded by ...` shape.
    expect(epicBody).toMatch(
      /party-mode override \(epic-fixture-precedence\):.*superseded by/,
    );
    // 2. Epic file's Locked decisions captures the new decision (referencing
    //    the new token `not-X` so validate-emit's check #6 can verify it).
    expect(epicBody).toMatch(/\*\*Locked decision:\*\*/);
    expect(epicBody).toMatch(/`not-X`/);
    // 3. Spec AC reflects the new decision.
    expect(specBody).toMatch(/`not-X`/);
    // 4. Spec status log records the propagation per the canonical
    //    `party-mode override: AC '<old>' → '<new>' per <reason>` shape.
    expect(specBody).toMatch(/party-mode override:.*AC.*→/);
  });
});

// ---------------------------------------------------------------------------
// 2) Doc-check — `.claude/commands/devx-plan.md` Phase 6 documents the
//    override flow per the pln104 contract. Guards against silent drift
//    between the AC's 4-step procedure and the skill body's text.
// ---------------------------------------------------------------------------

describe("/devx-plan skill body documents the override flow (pln104)", () => {
  // Path is relative to the repo root (vitest runs from there). Resolved
  // against process.cwd() so the test works whether vitest is invoked from
  // the repo or a worktree (worktree paths still root at the worktree).
  const skillPath = join(process.cwd(), ".claude/commands/devx-plan.md");
  const body = readFileSync(skillPath, "utf-8");

  // Slice the Phase 6 section so the doc-check doesn't false-positive on
  // mentions of "Locked decisions" elsewhere (e.g., Phase 5 retro story
  // emit text mentions locked-decision #7). Phase 6.5 starts the next
  // section; we slice between the two headings.
  const phase6Start = body.indexOf("### Phase 6: Party-Mode Refinement");
  const phase65Start = body.indexOf("### Phase 6.5:");
  if (phase6Start === -1 || phase65Start === -1) {
    throw new Error(
      "could not locate Phase 6 / Phase 6.5 headings in devx-plan.md",
    );
  }
  const phase6 = body.slice(phase6Start, phase65Start);

  it("Phase 6 quotes the source-of-truth precedence ordering", () => {
    // Spec AC > epic locked decisions > plan frontmatter > devx.config.yaml
    // > skill defaults. The exact ordering is load-bearing — DESIGN.md is
    // the authority. Whitespace tolerated; ordering of the five tokens is
    // not. The five names match the canonical labels exactly.
    expect(phase6).toMatch(
      /spec ACs\s*>\s*epic locked decisions\s*>\s*plan frontmatter\s*>\s*devx\.config\.yaml\s*>\s*skill defaults/,
    );
  });

  it("Phase 6 references DESIGN.md § Source-of-truth precedence as the authority", () => {
    expect(phase6).toMatch(
      /docs\/DESIGN\.md.*[Ss]ource-of-truth precedence/,
    );
  });

  it("Phase 6 documents the 4-step override procedure (lock → compare → update epic → propagate to spec)", () => {
    // Lock — the new decision is captured.
    expect(phase6).toMatch(/Lock the decision/i);
    // Compare against draft epic + spec ACs.
    expect(phase6).toMatch(/Compare/i);
    // On conflict, update epic Locked decisions + epic status log.
    expect(phase6).toMatch(/update the epic|epic file's status log|epic.*status.log/i);
    // Propagate to the affected spec ACs.
    expect(phase6).toMatch(/[Pp]ropagate to the spec|rewrite the affected spec/);
    // Spec status log gets the override propagation line.
    expect(phase6).toMatch(/SPEC's `## Status log`|spec's? status log/i);
  });

  it("Phase 6 wires validate-emit as the structural-drift catch for the override flow", () => {
    // The skill body must say validate-emit catches the drift case (step 3
    // done but step 4 not done) — this is the runtime mechanism pln104
    // relies on.
    expect(phase6).toMatch(/validate-emit/);
    expect(phase6).toMatch(/locked-decision-token-missing-from-spec/);
  });

  it("Phase 6 names pln104 (closure of the LEARN.md source-of-truth precedence cross-epic pattern)", () => {
    // Anchor for future LearnAgent passes — the pattern is closed at
    // planning time, not /devx claim time.
    expect(phase6).toMatch(/pln104/);
  });
});

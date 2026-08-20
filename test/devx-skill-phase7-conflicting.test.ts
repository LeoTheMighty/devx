// Phase 7 `pr-conflicting` routing discipline (debug-c94f14 AC #3).
//
// The library change alone doesn't close the incident: the probe can name the
// state perfectly and the run still burns 50 minutes if the skill body routes
// it to the same INTERVIEW escalation `empty` gets. PR #118 (2026-08-05) is
// the record — 41 `{"state":"empty"}` probes over ~50 minutes for a condition
// (`mergeable: CONFLICTING` / `mergeStateStatus: DIRTY`) that a `git merge
// origin/main && git push` cleared in seconds.
//
// Pins:
//   • Phase 7 step 4 has a `pr-conflicting` bullet at all.
//   • It routes to the self-service fix (merge the base branch in, resolve,
//     push, re-probe) and NOT to INTERVIEW — the escalation stays reserved
//     for genuinely unexplained silence.
//   • The merge invocation is present verbatim (roc101 pattern — a
//     paraphrased command is a command an agent has to invent).
//   • The base branch is derived, never hardcoded `develop`/`main` — the
//     pln101 regression class.
//   • The packaged mirror carries the same routing.
//
// Why a discipline test on markdown: same reason as dvx101, dvx105, dvx106,
// roc101 and mss104 — the skill body is the program, and un-pinned prose
// drifts back to the shape that caused the incident.
//
// Spec: debug/debug-c94f14-2026-08-05T14:05-await-remote-ci-conflicting-pr-blind.md

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx.md");
const MIRROR_PATH = resolve(REPO_ROOT, "skills/devx.md");

function loadSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

/**
 * Extract the `### Phase 7: …` body up to the next heading at any level.
 * Bounding on `^(### |## )` (not just `^### `) mirrors phase9Body — a slice
 * that spills into Phase 8 would let an assertion match unrelated prose.
 */
function phase7Body(skill: string): string {
  const start = skill.match(/^### Phase 7:[^\n]*\n/m);
  if (!start) throw new Error("Phase 7 heading not found in skill body");
  const offset = (start.index ?? 0) + start[0].length;
  const rest = skill.slice(offset);
  const next = rest.match(/^(### |## )/m);
  return next ? rest.slice(0, next.index) : rest;
}

/** The `pr-conflicting` bullet: from its state literal to the next bullet. */
function conflictingBullet(skill: string): string {
  const body = phase7Body(skill);
  const start = body.indexOf('**`{"state":"pr-conflicting"');
  if (start === -1) {
    throw new Error("Phase 7 has no pr-conflicting bullet");
  }
  const rest = body.slice(start);
  const next = rest.slice(1).search(/\n {3}- \*\*`\{"state"/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("devx skill — Phase 7 routes pr-conflicting (c94f14 AC #3)", () => {
  it("Phase 7 has a pr-conflicting bullet", () => {
    expect(() => conflictingBullet(loadSkill())).not.toThrow();
  });

  it("names the root cause: GitHub cannot build the merge ref", () => {
    // Without the "why", an agent re-probes hoping it clears on its own —
    // which is exactly the 41-probe behaviour this spec kills.
    expect(conflictingBullet(loadSkill())).toMatch(
      /cannot build the PR's merge ref/,
    );
  });

  it("routes to self-service, explicitly NOT to INTERVIEW", () => {
    const bullet = conflictingBullet(loadSkill());
    expect(bullet).toMatch(/self-serviceable/);
    expect(bullet).toMatch(/do NOT file INTERVIEW/);
    // …and it must not tell the agent to sit and wait, in any of the three
    // shapes the `empty` bullet uses.
    expect(bullet).toMatch(/do NOT wait/);
  });

  it("carries the merge-the-base-branch-in fix verbatim", () => {
    const bullet = conflictingBullet(loadSkill());
    expect(bullet).toContain("git fetch origin <integration-branch>");
    expect(bullet).toContain("git merge origin/<integration-branch>");
    expect(bullet).toContain("git push");
  });

  it("derives the base branch instead of hardcoding one (pln101 class)", () => {
    const bullet = conflictingBullet(loadSkill());
    expect(bullet).toContain(
      "`git.integration_branch ?? git.default_branch`",
    );
  });

  it("sends the agent back to the probe step after the push", () => {
    // A fix that stops at "pushed" leaves the PR unmerged with green CI —
    // the loop-tail hand-off shape, for a fully self-serviced problem.
    expect(conflictingBullet(loadSkill())).toMatch(/go back to step 4/);
  });

  it("keeps the INTERVIEW escalation on the empty bullet, scoped to unexplained silence", () => {
    const body = phase7Body(loadSkill());
    const emptyStart = body.indexOf('**`{"state":"empty"}`**');
    expect(emptyStart).toBeGreaterThan(-1);
    const emptyBullet = body.slice(
      emptyStart,
      body.indexOf('**`{"state":"pr-conflicting"'),
    );
    expect(emptyBullet).toMatch(/INTERVIEW\.md/);
    expect(emptyBullet).toMatch(/unexplained silence/);
  });

  it("the packaged mirror carries the same routing", () => {
    // skills/devx.md is byte-identical to the canonical file
    // (test/skills-sync.test.ts) — asserted independently so a mirror that
    // ships without the fix fails here too, naming the file.
    const mirror = readFileSync(MIRROR_PATH, "utf8");
    expect(mirror).toContain('**`{"state":"pr-conflicting"');
    expect(mirror).toContain("git merge origin/<integration-branch>");
  });
});

// Phase 1 resume-detection discipline assertion (roc101).
//
// Pins the structural shape of `.claude/commands/devx.md` Phase 1's
// resume-detection branch so future edits can't quietly drift away from the
// contract roc101 establishes:
//
//   • The branch fires when the resolved spec is `status: in-progress` AND
//     `.worktrees/dev-<hash>/` exists — and it runs BEFORE any worktree edit
//     (and before the step-4 fresh claim).
//   • The verify-claim invocation appears verbatim:
//     `devx devx-helper verify-claim <hash> --session-token "$SESSION_TOKEN"`.
//   • All four exit codes are dispatched: 0 → resume; 3 → halt + surface
//     owner mismatch WITHOUT touching the worktree; 4 → file INTERVIEW.md +
//     halt; 2 → surface stderr + stop.
//
// Why a discipline test on a markdown file: the skill body IS the program
// that runs Phase 1. The resume-collision incident (2026-05-07, LEARN.md §
// epic-devx-skill E13) happened precisely because the skill body had no
// ownership check on the resume path; this test is the lock that keeps the
// fix from silently regressing. Same pattern as
// devx-skill-phase8-discipline.test.ts (dvx106) and
// devx-handoff-snippet.test.ts (dvx107).
//
// Spec: dev/dev-roc101-2026-05-07T08:50-devx-resume-owner-check.md

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx.md");

function loadSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

/** Extract the body of `### Phase 1: …` up to the next `###` heading or EOF. */
function phase1Body(skill: string): string {
  const start = skill.match(/^### Phase 1:[^\n]*\n/m);
  if (!start) throw new Error("Phase 1 heading not found in skill body");
  const offset = (start.index ?? 0) + start[0].length;
  const rest = skill.slice(offset);
  const next = rest.match(/^### /m);
  return next ? rest.slice(0, next.index) : rest;
}

/** Extract the resume-detection subsection (bold intro → next numbered step). */
function resumeBlock(body: string): string {
  const start = body.indexOf("**Resume-detection branch");
  if (start === -1) throw new Error("resume-detection block not found");
  const rest = body.slice(start);
  // Bound on the step-4 fresh-claim bullet that follows the subsection.
  const end = rest.search(/^4\. \*\*Atomically claim\*\*/m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("devx skill — Phase 1 resume-detection discipline (roc101)", () => {
  it("Phase 1 contains the resume-detection branch subsection", () => {
    const body = phase1Body(loadSkill());
    expect(body).toMatch(/\*\*Resume-detection branch \(roc101\)\.\*\*/);
  });

  it("branch condition is `status: in-progress` + existing `.worktrees/dev-<hash>/` (AC)", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    expect(block).toMatch(/`status: in-progress`/);
    expect(block).toMatch(/\.worktrees\/dev-<hash>\//);
  });

  it("invokes verify-claim verbatim, with the --session-token flag (AC)", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    // Verbatim command shape — a rename of the subcommand or flag fails
    // the assertion (deliberately).
    expect(block).toMatch(
      /devx devx-helper verify-claim <hash> --session-token/,
    );
  });

  it("token-provenance rule is pinned: never copy the token from the spec/lock (self-defeating)", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    // The anti-pattern that would defeat the whole check: a fresh session
    // reading `owner:` out of the spec and passing it back as its own
    // token. The skill body must forbid it explicitly.
    expect(block).toMatch(
      /Never copy the token out of the spec's `owner:` frontmatter or the lock file/,
    );
    // And the safe fresh-session default: omit the flag, let auto-derive
    // mismatch.
    expect(block).toMatch(/OMITS the flag/);
  });

  it("verify-claim runs BEFORE any worktree edit and BEFORE the step-4 fresh claim", () => {
    const body = phase1Body(loadSkill());
    const verifyIdx = body.indexOf("devx devx-helper verify-claim");
    const claimIdx = body.indexOf("devx devx-helper claim");
    expect(verifyIdx).toBeGreaterThanOrEqual(0);
    expect(claimIdx).toBeGreaterThanOrEqual(0);
    expect(verifyIdx).toBeLessThan(claimIdx);
    // The BEFORE-any-worktree-edit invariant is stated explicitly.
    expect(resumeBlock(body)).toMatch(/BEFORE any worktree edit/);
  });

  it("exit 0 route: resume (skip the fresh claim, enter the existing worktree)", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    expect(block).toMatch(/\*\*0\*\*[\s\S]*?"owned":\s*true/);
    expect(block).toMatch(/\*\*0\*\*[\s\S]*?[Rr]esume/);
  });

  it("exit 3 route: halt without touching the worktree + surface owner mismatch", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    const route = block.match(/- \*\*3\*\*[\s\S]*?(?=\n\s*- \*\*\d\*\*|$)/);
    expect(route).not.toBeNull();
    expect(route?.[0]).toMatch(/owned-by-other-session/);
    expect(route?.[0]).toMatch(/HALT without touching the worktree/);
    expect(route?.[0]).toMatch(/lockOwner/);
    expect(route?.[0]).toMatch(/currentSession/);
  });

  it("exit 4 route: file INTERVIEW.md (resume-or-release) + halt", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    const route = block.match(/- \*\*4\*\*[\s\S]*?(?=\n\s*- \*\*\d\*\*|$)/);
    expect(route).not.toBeNull();
    expect(route?.[0]).toMatch(/in-progress-without-lock/);
    expect(route?.[0]).toMatch(/INTERVIEW\.md/);
    expect(route?.[0]).toMatch(/halt/i);
  });

  it("exit 2 route: surface stderr and stop", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    const route = block.match(/- \*\*2\*\*[\s\S]*?(?=\n\s*- \*\*\d\*\*|$)/);
    expect(route).not.toBeNull();
    expect(route?.[0]).toMatch(/stderr/);
    expect(route?.[0]).toMatch(/stop/i);
  });

  it("fresh-claim fall-through is documented (non-resume specs still hit step 4)", () => {
    const block = resumeBlock(phase1Body(loadSkill()));
    expect(block).toMatch(/fall through to step 4/i);
  });
});

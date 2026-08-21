// Phase 8 dispatch discipline assertion (dvx106).
//
// Pins the structural shape of `.claude/commands/devx.md` Phase 8 so that
// future edits can't quietly drift away from the contract dvx106 establishes:
//
//   • First action of Phase 8 is `devx merge-gate <hash>` (AC #1).
//   • merge:true branch documents `gh pr merge <#> --squash --delete-branch`
//     AND the post-merge verify command `gh pr view <#> --json state,mergeCommit`
//     (AC #2 + reaffirms feedback_gh_pr_merge_in_worktree.md — the verify is
//     what tells us a worktree-exit-nonzero merge actually succeeded
//     remotely).
//   • merge:false branch documents handling for all three advice keywords
//     (AC #3): "file INTERVIEW for approval", "wait for CI", "manual merge
//     required".
//   • The "Behavior by mode" enumeration (the YOLO/BETA/PROD/LOCKDOWN bullets
//     restating mode logic in the skill body) is REMOVED — single source of
//     truth lives in `mergeGateFor` / the merge-gate CLI (AC #5).
//
// Why a discipline test on a markdown file: the skill body IS the program
// that runs Phase 8. Inlining bash that re-implements mode logic was the
// regression vector tracked in LEARN.md cross-epic patterns (the same one
// that motivated dvx101 push-before-PR, mrg102 merge-gate, prt102 pr-body,
// dvx105 await-remote-ci). This test is the lock that catches drift.
//
// Spec: dev/dev-dvx106-2026-04-28T19:30-devx-auto-merge-gate.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx.md");

function loadSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

/** Extract the body of `### Phase 8: …` up to the next `###` heading or EOF. */
function phase8Body(skill: string): string {
  const start = skill.match(/^### Phase 8:[^\n]*\n/m);
  if (!start) throw new Error("Phase 8 heading not found in skill body");
  const offset = (start.index ?? 0) + start[0].length;
  const rest = skill.slice(offset);
  const next = rest.match(/^### /m);
  return next ? rest.slice(0, next.index) : rest;
}

describe("devx skill — Phase 8 dispatch discipline (dvx106)", () => {
  it("Phase 8 invokes `devx merge-gate <hash>` as its first executable action (AC #1)", () => {
    const body = phase8Body(loadSkill());
    // The phrase appears in a fenced code block:
    //   ```
    //   devx merge-gate <hash>
    //   ```
    // Anchor on the literal command shape so a rename of merge-gate fails
    // the assertion (deliberately).
    expect(body).toMatch(/devx merge-gate <hash>/);

    // It must come BEFORE any `gh pr merge` call — i.e. the gate is the
    // gate, not an afterthought.
    const mergeGateIdx = body.indexOf("devx merge-gate <hash>");
    const ghMergeIdx = body.indexOf("gh pr merge");
    expect(mergeGateIdx).toBeGreaterThanOrEqual(0);
    expect(ghMergeIdx).toBeGreaterThanOrEqual(0);
    expect(mergeGateIdx).toBeLessThan(ghMergeIdx);
  });

  it("Phase 8 documents the JSON output shape `{merge, reason, advice?}` (AC #1)", () => {
    const body = phase8Body(loadSkill());
    // The shape is referenced verbatim in the dispatch table.
    expect(body).toMatch(/"merge":\s*true/);
    expect(body).toMatch(/"merge":\s*false/);
    expect(body).toMatch(/advice/);
  });

  it("merge:true branch documents `gh pr merge <#> --squash --delete-branch` (AC #2)", () => {
    const body = phase8Body(loadSkill());
    expect(body).toMatch(/gh pr merge .* --squash --delete-branch/);
  });

  it("merge:true branch documents the `gh pr view --json state,mergeCommit` verify (AC #2 + feedback_gh_pr_merge_in_worktree.md)", () => {
    const body = phase8Body(loadSkill());
    // Verify command lives RIGHT AFTER the merge command — it's how we tell
    // a worktree-exit-nonzero merge from an actual failure.
    expect(body).toMatch(/gh pr view .* --json state,mergeCommit/);
    // Discipline: the worktree-exit-nonzero scenario is documented so the
    // next maintainer knows why the verify exists.
    expect(body).toMatch(/feedback_gh_pr_merge_in_worktree|worktree.*exit.*non.*zero/i);
  });

  it("merge:false branch documents all three advice keywords (AC #3)", () => {
    const body = phase8Body(loadSkill());
    // Each keyword must be documented as a route the dispatch handles.
    expect(body).toMatch(/file INTERVIEW for approval/);
    expect(body).toMatch(/wait for CI/);
    expect(body).toMatch(/manual merge required/);
  });

  it("merge:false: 'file INTERVIEW for approval' route documents INTERVIEW.md write (AC #3a)", () => {
    const body = phase8Body(loadSkill());
    // Anchor on the bulleted route entry (preceded by `**\``) to avoid
    // the dispatch-table mention of the keyword (which is just declaring
    // the shape of the JSON output, not the route handler). Bound the
    // window on the next route bullet (`**\`"`) or end-of-block — keeps
    // the assertion from cross-bleeding into the next route.
    const routeMatch = body.match(
      /\*\*`"file INTERVIEW for approval"`\*\*[\s\S]*?(?=\n- \*\*`"|\n\*\*Merge command|$)/,
    );
    expect(routeMatch).not.toBeNull();
    expect(routeMatch?.[0]).toMatch(/INTERVIEW\.md/);
  });

  it("merge:false: 'wait for CI' route documents Phase 7 polling re-entry (AC #3b)", () => {
    const body = phase8Body(loadSkill());
    const routeMatch = body.match(
      /\*\*`"wait for CI"`\*\*[\s\S]*?(?=\n- \*\*`"|\n\*\*Merge command|$)/,
    );
    expect(routeMatch).not.toBeNull();
    // The route's behavior is "re-enter Phase 7 polling".
    expect(routeMatch?.[0]).toMatch(/Phase 7|re-enter|re-?poll/i);
  });

  it("merge:false: 'manual merge required' route documents MANUAL.md write (AC #3c)", () => {
    const body = phase8Body(loadSkill());
    const routeMatch = body.match(
      /\*\*`"manual merge required"`\*\*[\s\S]*?(?=\n- \*\*`"|\n\*\*Merge command|$)/,
    );
    expect(routeMatch).not.toBeNull();
    expect(routeMatch?.[0]).toMatch(/MANUAL\.md/);
  });

  it("Phase 8 after-merge bookkeeping is ONE commit on main, pushed (AC #4)", () => {
    const body = phase8Body(loadSkill());
    // The bookkeeping commit must be a single commit covering DEV.md +
    // spec status + workstream todo + PR URL append.
    //
    // sgr105 collapsed the four hand-edits into `devx devx-helper
    // mark-done`, so the commit step no longer names a step RANGE — it
    // names the pathspecs the helper returned. The older `all of (N-M)` /
    // `steps N–M` phrasings stay as accepted alternatives so this assertion
    // remains about "it's ONE commit" rather than about wording.
    expect(body).toMatch(
      /(one commit|single commit|all of \(\d+-\d+\) on `main`|Commit steps \d+[–-]\d+ on `main`|Commit the pathspecs)/i,
    );
    expect(body).toMatch(/chore: mark .* done after PR/);
    // AC #4 explicitly says the commit is pushed to origin/main. The
    // feedback_devx_push_claim_before_pr.md memory tracks the exact
    // regression mode of forgetting this push — pinning the word here
    // catches a future maintainer who drops "and push" from the
    // bookkeeping step.
    // All phrasings accepted (see the note above); the window is wide
    // because the 2026-07-29 staging-discipline sentence now sits between
    // the commit instruction and the word "push".
    expect(body).toMatch(
      /Commit (all of \(\d+-\d+\)|steps \d+[–-]\d+|the pathspecs)[\s\S]{0,600}push/i,
    );
  });

  it("the 'Behavior by mode' enumeration is REMOVED from the skill body (AC #5)", () => {
    const skill = loadSkill();
    // The skill body must NOT contain the enumerated mode bullets that
    // re-state mode logic. Phase 1 of dvx106 inverts the prior shape:
    // mode logic lives ONLY in mergeGateFor; the skill body just calls it.
    //
    // Heuristic: a "Behavior by mode" heading is the canonical form. If a
    // future maintainer reintroduces the enumeration under a different
    // heading the second assertion catches the most common shape (four
    // mode names sequentially in skill body bullet form within a window
    // of ~400 chars). This is a soft heuristic — if you're seeing this
    // test fail because of a legitimate mode-summary table, prefer
    // moving it to docs/MODES.md and linking from the skill body.
    expect(skill).not.toMatch(/^### Behavior by mode/m);
    expect(skill).not.toMatch(/^## Behavior by mode/m);

    // No mode bullet enumeration in the skill body that re-states the
    // gate's logic. We allow the literal mode names in prose (e.g.,
    // "YOLO single-branch") but block the bullet-list shape that
    // duplicates merge-gate decisions.
    //
    // Pattern: four lines, each starting with `   - ` or `- ` and the
    // backtick-mode-name + ` — `, restating merge logic. If this pattern
    // appears the skill body has reabsorbed the gate's responsibility.
    const modeBullet = /(\s*-\s+`(YOLO|BETA|PROD|LOCKDOWN)`\s+—\s+(merge|do not merge))/g;
    const matches = skill.match(modeBullet) ?? [];
    expect(matches.length).toBeLessThan(4);
  });

  it("YOLO autonomy invariant is documented and unambiguous (reaffirms feedback_yolo_auto_merge.md)", () => {
    const body = phase8Body(loadSkill());
    // Phase 8 must explicitly state YOLO's auto-merge stance — the memory
    // says agents have repeatedly reverted to "leave PR for human merge"
    // in YOLO, which is wrong. Pinning the language structurally keeps
    // the regression from quietly returning.
    expect(body).toMatch(
      /YOLO.*auto[- ]?merge|YOLO.*merges (its own|automatically)|fully autonomous/,
    );
  });
});

/**
 * Explicit-pathspec staging discipline (learn 2026-07-29).
 *
 * The `never git add -A` rule lived only in Phase 6, which covers the
 * feature-branch commit inside an isolated worktree — the one place a
 * blanket stage is nearly harmless. Phase 8's after-merge bookkeeping
 * commits on `main`, the single tree every concurrent session shares, and
 * carried no staging instruction at all. A `git add -A` there sweeps peers'
 * in-flight spec and todo edits into your commit: the content survives, but
 * authorship is wrong and the audit trail lies. Observed twice, most
 * recently erratum `ba3c65b` (commit `ac0ccf2` carried two files belonging
 * to a live mss104 session).
 *
 * Pinned in BOTH phases so a future edit can't quietly drop either copy.
 */
describe("devx skill — explicit-pathspec staging discipline (learn 2026-07-29)", () => {
  const NEVER_ADD_ALL = /never `git add -A`/;

  it("Phase 6 keeps its explicit-pathspec rule", () => {
    const skill = loadSkill();
    const phase6 = skill.match(/^### Phase 6:[\s\S]*?(?=^### )/m)?.[0] ?? "";
    expect(phase6).not.toBe("");
    expect(phase6).toMatch(NEVER_ADD_ALL);
  });

  it("Phase 8's after-merge commit step carries the same rule", () => {
    const body = phase8Body(loadSkill());
    // Phase 8 is where it actually bites — main is shared. Asserting on the
    // phase body (not the whole file) is what makes this independent of the
    // Phase 6 assertion above; a single stray mention elsewhere won't
    // satisfy it.
    expect(body).toMatch(NEVER_ADD_ALL);
  });

  it("Phase 8's after-merge list is contiguously numbered and every step reference resolves", () => {
    const body = phase8Body(loadSkill());
    const afterMerge = body.slice(body.indexOf("After merge:"));
    expect(afterMerge).not.toBe("");

    // The list previously ran 1,2,3,4,5,7,8,9 — no step 6 — while step 7
    // instructed "Commit all of (4-6)", a range whose upper bound did not
    // exist. An agent cannot resolve that; renumbering is the fix and this
    // asserts it stays fixed.
    //
    // The floor has ratcheted DOWN twice, both times because a step count
    // collapsed into a primitive: sgr105 folded four hand-edits into
    // `mark-done`, and b931a1 folded the remaining git sequence (pull,
    // commit, push, lock release, worktree removal, rebuild) into
    // `finalize`. A high floor would now be a test asserting that the tail
    // is still prose — the opposite of what this file is for. What the
    // assertion is actually about survives at any length: numbering is
    // contiguous, and every `step N` reference resolves.
    const numbers = [...afterMerge.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < numbers.length; i += 1) {
      expect(numbers[i]).toBe(i + 1);
    }

    // Every step reference — whether a range ("steps N–M") or a single
    // step ("step N") — must name a step that exists. This is the general
    // form of the bug the range check caught.
    const ranges = [...afterMerge.matchAll(/steps (\d+)[–-](\d+)/g)];
    for (const [, lo, hi] of ranges) {
      expect(numbers).toContain(Number(lo));
      expect(numbers).toContain(Number(hi));
    }
    const singles = [...afterMerge.matchAll(/\bstep (\d+)\b/g)];
    expect(ranges.length + singles.length).toBeGreaterThan(0);
    for (const [, n] of singles) {
      expect(numbers).toContain(Number(n));
    }
  });
});

/**
 * mark-done host discipline (sgr105).
 *
 * Phase 8's after-merge bookkeeping was four hand-edits on `main` — spec
 * frontmatter, backlog row, workstream todo, and (post-sgr104) an implicit
 * board regen that prose never mentioned. Hand-editing is what produced the
 * `git add -A` cleanup-commit class (erratum `ba3c65b`, twice). sgr105 makes
 * the closing flip mechanical the way dvx101 made the opening one: one CLI
 * call that returns the exact pathspecs to stage.
 *
 * These assertions are the lock. The regression shape they foreclose is an
 * agent reading Phase 8, deciding the helper is optional, and editing the
 * three files by hand — which reintroduces both the torn-write race and the
 * blanket-stage authorship bug.
 */
describe("devx skill — Phase 8 mark-done host (sgr105)", () => {
  it("the after-merge bookkeeping invokes `devx devx-helper mark-done`", () => {
    const body = phase8Body(loadSkill());
    expect(body).toMatch(
      /devx devx-helper mark-done <hash> --pr <n> --merge-sha <merge-sha>/,
    );
  });

  it("mark-done runs AFTER the merge verify, not before", () => {
    const body = phase8Body(loadSkill());
    const verifyIdx = body.indexOf("gh pr view");
    const markDoneIdx = body.indexOf("devx devx-helper mark-done");
    expect(verifyIdx).toBeGreaterThanOrEqual(0);
    expect(markDoneIdx).toBeGreaterThan(verifyIdx);
  });

  it("all three exit codes are documented as routes", () => {
    const body = phase8Body(loadSkill());
    const afterMerge = body.slice(body.indexOf("After merge:"));
    // 0 hands back `paths`; 1 is the do-not-write state mismatch (plus
    // retryable lock contention); 2 is stop-and-surface.
    expect(afterMerge).toMatch(/\*\*0\*\*[^\n]*paths/);
    expect(afterMerge).toMatch(/\*\*1\*\*[^\n]*state mismatch/i);
    expect(afterMerge).toMatch(/\*\*2\*\*/);
  });

  it("the commit step stages the pathspecs mark-done returned", () => {
    const body = phase8Body(loadSkill());
    const afterMerge = body.slice(body.indexOf("After merge:"));
    // The `paths` handoff is the mechanism that makes explicit-pathspec
    // staging structural instead of a rule to remember.
    expect(afterMerge).toMatch(/git add -- <paths from step \d+>/);
  });

  it("the after-merge tail is invoked as the `finalize` primitive, not enumerated git (b931a1)", () => {
    const body = phase8Body(loadSkill());
    const afterMerge = body.slice(body.indexOf("After merge:"));
    expect(afterMerge).toMatch(
      /devx devx-helper finalize <hash> --pr <n> --merge-sha <merge-sha>/,
    );
    // The four inline git commands the primitive replaced must not come
    // BACK as instructions. They are still allowed to appear inside exit
    // 3's by-hand recovery list — that path exists precisely because the
    // primitive stopped halfway — so the assertion is scoped to the tail
    // ABOVE that list.
    const recoveryIdx = afterMerge.indexOf("Do not re-run finalize");
    expect(recoveryIdx).toBeGreaterThan(0);
    const beforeRecovery = afterMerge.slice(0, recoveryIdx);
    expect(beforeRecovery).not.toMatch(/^\s*\d+\. `git fetch/m);
    expect(beforeRecovery).not.toMatch(/^\s*\d+\. Remove worktree: `git worktree remove/m);
    expect(beforeRecovery).not.toMatch(/^\s*\d+\. Delete local branch/m);
  });

  it("the tail documents all FOUR finalize exit codes, including the post-write tier", () => {
    const body = phase8Body(loadSkill());
    const afterMerge = body.slice(body.indexOf("After merge:"));
    // Exit 3 is the one that carries new information: the flips landed, so
    // re-running is wrong. An agent that treats 3 like 1 or 2 re-runs
    // finalize, hits a state mismatch on an already-`[x]` row, and reports
    // a failure that is really a success plus one unfinished stage.
    expect(afterMerge).toMatch(/\*\*3\*\*/);
    expect(afterMerge).toMatch(/Do not re-run finalize/i);
  });

  it("the tail names the spec-lock release and the dist rebuild (E3 + E2)", () => {
    const body = phase8Body(loadSkill());
    const afterMerge = body.slice(body.indexOf("After merge:"));
    // Both stages exist because nothing owned them: 14 dead locks
    // accumulated on disk, and `devx` on PATH ran pre-merge code for as
    // long as nobody rebuilt main's dist by hand.
    expect(afterMerge).toMatch(/spec-<hash>\.lock/);
    expect(afterMerge).toMatch(/rebuilds?\*{0,2} the main worktree's `dist\//i);
  });

  it("Phase 8 forbids hand-editing the artifacts mark-done owns", () => {
    const body = phase8Body(loadSkill());
    expect(body).toMatch(/Do NOT hand-edit the spec, the backlog row, or `todo\.md`/);
  });

  it("Phase 8 no longer instructs the hand-edit sequence mark-done replaced", () => {
    const afterMerge = phase8Body(loadSkill());
    // The pre-sgr105 imperatives. Their return means an agent is being told
    // to do by hand what the helper does transactionally under the lock.
    expect(afterMerge).not.toMatch(/^\d+\. Update the spec file: `status: done`/m);
    expect(afterMerge).not.toMatch(/^\d+\. Update `DEV\.md`: flip the checkbox/m);
    expect(afterMerge).not.toMatch(
      /^\d+\. If the item belongs to a workstream, run `devx todo sync/m,
    );
  });
});

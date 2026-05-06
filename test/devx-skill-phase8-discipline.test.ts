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
    // spec status + sprint-status + PR URL append.
    expect(body).toMatch(/(one commit|single commit|all of \(\d+-\d+\) on `main`)/i);
    expect(body).toMatch(/chore: mark .* done after PR/);
    // AC #4 explicitly says the commit is pushed to origin/main. The
    // feedback_devx_push_claim_before_pr.md memory tracks the exact
    // regression mode of forgetting this push — pinning the word here
    // catches a future maintainer who drops "and push" from the
    // bookkeeping step.
    expect(body).toMatch(/Commit all of \(\d+-\d+\)[\s\S]{0,200}push/i);
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

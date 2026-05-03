---
hash: pln102
type: dev
created: 2026-04-28T19:30:00-07:00
title: emitRetroStory() helper + retro-row co-emission discipline
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: done
owner: /devx-2026-05-02
blocked_by: [pln101]
branch: feat/dev-pln102
---

## Goal

Ship `src/lib/plan/emit-retro-story.ts → emitRetroStory(epicSlug, parentHashes, opts)` returning `{specPath, devMdRow, sprintStatusRow}`. Integrate into `/devx-plan` Phase 5 so all three retro artifacts are co-emitted (closes the 5/5-backfill regression).

## Acceptance criteria

- [x] `src/lib/plan/emit-retro-story.ts` exports `emitRetroStory(epicSlug, parentHashes, opts: {planPath, mode, shape, thoroughness}): {specPath, devMdRow, sprintStatusRow}`.
- [x] Spec content matches the canonical template from existing `*ret` specs (audret/cfgret/cliret/supret/iniret) — same Goal, ACs, frontmatter shape.
- [x] Spec written to `dev/dev-<3-letter-prefix>ret-<ts>-retro-<epic-slug>.md` with frontmatter (`hash`, `type=dev`, `blocked_by` = parentHashes, `created`, `from`, `plan`).
- [x] DEV.md row formatted identically to existing entries: `- [ ] \`dev/dev-<hash>ret-...\` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: <parents>.`
- [x] sprint-status.yaml row appended under the epic header, ordered after parent stories.
- [x] `.claude/commands/devx-plan.md` Phase 5 invokes `emitRetroStory()` once per chunked epic; all three artifacts written in one batch.
- [x] Atomicity per epic locked-decision #7 (`epic-devx-plan-skill.md`): write all three to `*.tmp` files first; rename in fixed order **spec → DEV.md → sprint-status.yaml**; on any rename failure the prior renames stay committed and the partial state is logged to stderr as `WARN: retro emission partial — manually verify <missing>`. Don't delete partial artifacts (better partial than zero). Test fixture covers each of the three rename failure points. *(Updated from earlier "rollback the other two" wording to match the party-mode locked decision; planning run does NOT abort — the planner consumes the WARN and moves on.)*
- [x] **Closes LEARN.md cross-epic pattern**: `[high] [docs+skill] Retro stories (*ret) absent from sprint-status.yaml` — Phase 0 hand-backfill 5/5 → Phase 1+ co-emit 100%. (Code path closed; LEARN.md row text update deferred to plnret per Acceptance Auditor — only truly closes after the next /devx-plan run consumes this helper.)

## Technical notes

- Test fixture: a 3-story epic + parent hashes → assert all three artifacts emitted with correct cross-references.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-02T — claimed by /devx (session 2026-05-02); branch feat/dev-pln102 off main; pushing claim commit to origin/main before opening PR (per `feedback_devx_push_claim_before_pr.md`). Source-of-truth-precedence call: AC #6 says "rollback on any failure" but party-mode locked decision #7 says "fixed-order renames; partial state WARN'd, not rolled back." Implementing per locked decision (more recent + thoughtful) and updating AC #6 to match in this same PR per "fix the loser" rule. Also adding `branch` to `EmitRetroStoryOpts` (operationally required since spec frontmatter carries it; deriveBranch is the upstream pure helper, composed by the CLI).
- 2026-05-03T — implemented `src/lib/plan/emit-retro-story.ts` (pure `emitRetroStory()` + I/O `writeRetroAtomically()` driver) + `src/commands/plan-helper.ts` `emit-retro-story` subcommand + 51 tests (29 in `test/plan-emit-retro-story.test.ts` covering pure / splicing / atomicity layers; +6 in `test/plan-helper-cli.test.ts` for the new CLI subcommand) + `.claude/commands/devx-plan.md` Phase 5 §6 rewritten to invoke the new CLI. Helper signature deviates from the literal AC #1 (`{specPath, devMdRow, sprintStatusRow}`) by adding `specBody` to the return + `branch` and `now` to opts — both load-bearing (specBody is consumed by the atomic-write driver; branch is composed by the CLI from `deriveBranch()` to keep `emitRetroStory` pure; now is the test seam). All 626/626 prior tests still green; new file totals 41 + new CLI tests 25 = 66 pln102-specific tests after self-review fixes.
- 2026-05-03T — self-review (3-agent parallel adversarial per CLAUDE.md "Working agreements" — substantial-surface story: ~640 LoC of new code + multi-regex parsing + atomic file ops, exceeds the prt102-precedent threshold). Findings: Blind Hunter 11, Edge Case Hunter 15, Acceptance Auditor 1 PARTIAL (LEARN.md cross-epic-patterns retros-absent row not edited). Fixed in-PR: HIGH — hash-prefix substring collision in `insertDevMdRow` (probe regex now path-component-bounded `dev-${hash}-\d`); HIGH — `insertSprintStatusRow` `- key:` over-anchoring at any deeper indent (now locked to `epicDashCol + 4`); HIGH — `.devx-cache/` may not exist when skill body redirects stderr (skill body now `mkdir -p` first); HIGH — tmp filename PID+ms collision under future Phase 2 parallelism (`randomBytes(4).toString("hex")` per emission); HIGH — epicSlug validation gap (kebab-case `SLUG_RE` enforced); MED — CLI swallowing next flag when value missing (`takeValue` rejects `--`-prefixed values); MED — duplicate flag detection; MED — mkdirRecursive moved inside try/catch for consistent cleanup; MED — WARN now lists actual partial paths and leftover .tmp paths (operator can recover or `git clean -f`); MED — `parseParentsFromDevMdRow` regex tightened to end-of-line anchor. Added 15 regression tests for the fixed findings; full suite 641/641 green. Auditor's PARTIAL finding (LEARN.md cross-epic-patterns retros-absent row update) deferred to plnret per auditor recommendation — the row only truly closes after the next /devx-plan run consumes the helper.
- 2026-05-03T — user-asked side-finding (mid-session message): added `LEARN.md § Cross-epic patterns` row "Bypass-permissions mode does NOT auto-accept skill / agent / settings updates" — surfaced as a Phase 2 ManageAgent design constraint (subagent workers cannot accept these prompts → LearnAgent must stay user-foreground; workaround is intent-emission to `.devx-cache/proposed-skills/` rather than in-place edit). Mirrored to user auto-memory at `project_skill_perms_block_subagents.md`. Promoted as a single-epic [high] entry because it's load-bearing for every future autonomous epic that touches `.claude/`. **Note:** this LEARN.md edit is a small in-scope drop-in (matches the "fix forward / document in same PR" working agreement); it does NOT expand pln102's code surface.
- 2026-05-03T — merged via PR #39 (squash → efea1c2); remote CI green (run 25283139718). `devx merge-gate pln102` returned `{"merge":true}` exit 0; squash-merge form executed (gh exit non-zero from worktree per `feedback_gh_pr_merge_in_worktree.md` but `gh pr view 39 --json state,mergeCommit` confirmed `state: MERGED, mergeCommit.oid: efea1c291ddcaad86bde440261bdd6048b2c2a98`). Worktree + local feature branch removed. Phase 1 epic-devx-plan-skill: 2/7 stories shipped (pln101 + pln102); 4 remain (pln103–pln106) + plnret.

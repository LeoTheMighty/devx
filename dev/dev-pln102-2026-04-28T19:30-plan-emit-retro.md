---
hash: pln102
type: dev
created: 2026-04-28T19:30:00-07:00
title: emitRetroStory() helper + retro-row co-emission discipline
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
owner: /devx-2026-05-02
blocked_by: [pln101]
branch: feat/dev-pln102
---

## Goal

Ship `src/lib/plan/emit-retro-story.ts → emitRetroStory(epicSlug, parentHashes, opts)` returning `{specPath, devMdRow, sprintStatusRow}`. Integrate into `/devx-plan` Phase 5 so all three retro artifacts are co-emitted (closes the 5/5-backfill regression).

## Acceptance criteria

- [ ] `src/lib/plan/emit-retro-story.ts` exports `emitRetroStory(epicSlug, parentHashes, opts: {planPath, mode, shape, thoroughness}): {specPath, devMdRow, sprintStatusRow}`.
- [ ] Spec content matches the canonical template from existing `*ret` specs (audret/cfgret/cliret/supret/iniret) — same Goal, ACs, frontmatter shape.
- [ ] Spec written to `dev/dev-<3-letter-prefix>ret-<ts>-retro-<epic-slug>.md` with frontmatter (`hash`, `type=dev`, `blocked_by` = parentHashes, `created`, `from`, `plan`).
- [ ] DEV.md row formatted identically to existing entries: `- [ ] \`dev/dev-<hash>ret-...\` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: <parents>.`
- [ ] sprint-status.yaml row appended under the epic header, ordered after parent stories.
- [ ] `.claude/commands/devx-plan.md` Phase 5 invokes `emitRetroStory()` once per chunked epic; all three artifacts written in one batch.
- [ ] Atomicity per epic locked-decision #7 (`epic-devx-plan-skill.md`): write all three to `*.tmp` files first; rename in fixed order **spec → DEV.md → sprint-status.yaml**; on any rename failure the prior renames stay committed and the partial state is logged to stderr as `WARN: retro emission partial — manually verify <missing>`. Don't delete partial artifacts (better partial than zero). Test fixture covers each of the three rename failure points. *(Updated from earlier "rollback the other two" wording to match the party-mode locked decision; planning run does NOT abort — the planner consumes the WARN and moves on.)*
- [ ] **Closes LEARN.md cross-epic pattern**: `[high] [docs+skill] Retro stories (*ret) absent from sprint-status.yaml` — Phase 0 hand-backfill 5/5 → Phase 1+ co-emit 100%.

## Technical notes

- Test fixture: a 3-story epic + parent hashes → assert all three artifacts emitted with correct cross-references.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-02T — claimed by /devx (session 2026-05-02); branch feat/dev-pln102 off main; pushing claim commit to origin/main before opening PR (per `feedback_devx_push_claim_before_pr.md`). Source-of-truth-precedence call: AC #6 says "rollback on any failure" but party-mode locked decision #7 says "fixed-order renames; partial state WARN'd, not rolled back." Implementing per locked decision (more recent + thoughtful) and updating AC #6 to match in this same PR per "fix the loser" rule. Also adding `branch` to `EmitRetroStoryOpts` (operationally required since spec frontmatter carries it; deriveBranch is the upstream pure helper, composed by the CLI).

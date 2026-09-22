---
hash: 00b4d3
type: debug
created: 2026-09-02T14:36:00-06:00
title: "A layout-migration commit is blocked by devx outline check"
from: dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md
status: in-progress
owner: /devx-2026-09-21T1324-85133
branch: null
---

## Goal

A repo that runs `devx layout migrate` can commit the result and open a PR.

Today it cannot. `devx layout migrate` moves the human-only outline files —
AC 8 of dlr106 requires it, because a migration that moved everything except
the human's outlines would break the tree in the one place the human cares
most. But `devx outline check` classifies a path by NAME and fails the diff
whenever an outline appears in it and its content is not byte-identical to a
pristine scaffold. A rename satisfies neither condition it looks for, so the
migration commit is refused by the repo's own merge gate with no escape hatch.

Reproduced during dlr106's Phase 4 review (Blind Hunter finding 7): migrate,
`git add -A && git commit`, then

```
runOutlineCheck({ diff: "HEAD~1...HEAD" })
→ exit 1
  {"clean":false,"touched":["prd-outline.md"],"scaffolds":[],"range":"HEAD~1...HEAD"}
```

## Acceptance criteria

- [ ] AC 1: A repro exists — a test that migrates a fixture, commits, and
      asserts `devx outline check` on that range.
- [ ] AC 2: Root cause documented with evidence: which predicate in
      `src/lib/engine/outline.ts` / `src/commands/outline.ts` decides, and why
      a rename reaches it.
- [ ] AC 3: A pure rename whose blob is unchanged passes the check
      (`git diff --name-status -M` reports it as `R100`), OR an explicit,
      documented escape is defined. The guarantee must not weaken: a rename
      adds no human content, which is the same criterion the existing
      pristine-scaffold exemption already applies. A change of CONTENT plus a
      rename must still fail.
- [ ] AC 4: The chosen behavior is added to the migration's own
      documentation — MANUAL.md MV-a494be.1 currently tells the operator to
      expect this and work around it by hand.

## Technical notes

Deliberately NOT fixed inside dlr106. The fix edits the outline guard, which
is a three-layer human-only guarantee (PreToolUse hook + `outline check` +
`outline commit`) owned by a different subsystem, and dlr106's scope is the
migration surface. Widening a phase to weaken a guard it merely collides with
is how guards get weakened quietly — this gets its own diff and its own review.

Workaround until then, recorded in MANUAL.md MV-a494be.1: commit the outline
renames separately on the base branch with `devx outline commit`, or land the
migration on the base branch directly (migration is an attended, human-run
operation, so neither is the burden it would be for an agent flow).

## Status log

- 2026-09-02T14:36 — filed from dlr106 Phase 4 adversarial review (3-agent
  parallel shape; Blind Hunter finding 7, reproduced against a real fixture).
- 2026-09-21T13:24:10-06:00 — claimed by /devx in session /devx-2026-09-21T1324-85133
- 2026-09-21T13:25 — phase 1: run through the `/devx` skill, not the helpers by hand. Skill revision that ran: `main`'s `.claude/commands/devx.md` at `46c9829` (741 lines, 0 `tour` references; pre-#175 — its Phase 2 still reads "workstream artifacts live on `main`"). Confirmed by content, not assumed: the #175 worktree carries an edited copy, and it was not the one loaded. Profile preflight passed: every core key answered across the global and repo-individual layers; `review.above_threshold_shape: parallel` (repo floor).
- 2026-09-21T13:30 — phase 2: spec ACs direct (v2 native); 4 ACs; workstream=none (from dlr106, whose workstream is archived); red-artifacts=none — Stage: Debug, repro first.
- 2026-09-21T13:45 — phase 3 (repro, then root cause, then fix):
  - **Repro (AC 1)**, `test/outline-check-renames.test.ts`, RED against the unfixed code for the stated reasons: a REAL `devx layout migrate --to project-level`, committed, then `devx outline check` → exit 1 with the migrated prd outline listed as touched. **And a second, worse failure this spec did not name:** a human outline renamed to `notes.md` → exit **0**. The guard let a human's outline disappear from a PR unseen.
  - **Root cause (AC 2).** All three L2 sites (`devx outline check`, `devx merge-gate`'s `outlineClean`, the loop tail) read `git diff --name-only`. With git's default rename detection that lists only a rename's DESTINATION. `classifyDiffNames` (`src/lib/engine/outline.ts:197`) keeps protected names; `partitionOutlinePaths` (`src/lib/engine/outline-scaffold.ts:215`) marks non-scaffold content authored. Migrate: the destination is a protected outline holding human text → blocked. Rename-away: the destination is not an outline and the source is never listed → passes. The archive-style move passed only through that same hole: an archived outline path has no `workstreams` segment, so it is not protected.
  - **Fix (AC 3).** One shared `outlineDiffArgs` (`--name-status -M100%`: exact renames only) and one shared scan. A rename is a PURE MOVE, and exempt, only when it is `R100`, its source is a protected outline, and its destination is an outline of the SAME kind (stage → same stage, project → project); `outlineKindOf` decides kind from path shape, independent of protection. Everything else blocks: a protected outline renamed away counts as removed; a content change alongside a rename splits into D + A; a move to another stage's outline blocks. `devx outline check` now uses the shared scan instead of its own copy, which the scan's own comment had warned against. The JSON gains `moved`.
  - **AC 4.** MANUAL.md MV-a494be.1's workaround is replaced with the fixed behaviour; `v2/02-engine.md` names the new exemption. `CLAUDE.md` still says the check "fails when a PR diff carries" an outline — incomplete rather than unsafe; left for the user, not edited by an agent.
- 2026-09-22T09:36-06:00 — phase 4: 3-agent PARALLEL adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, fanned out as subagents), run PRE-MERGE against the uncommitted diff. Findings: Blind Hunter 3 in-change (2 HIGH, 1 LOW) + 2 pre-existing; Edge Case Hunter 4 in-change (1 HIGH, 2 MED, 1 LOW) + 3 pre-existing; Acceptance Auditor 5 (1 MED, 4 LOW). **12 in-change findings, all fixed.** The load-bearing ones: the phase-3 "same kind" exemption above was itself a guard hole — it passed a move into another workstream, the root project outline moved under a subdirectory, a trailing-space rename (the unquote trimmed), and moves into `docs/prd/` or `_devx/templates/`. It is REPLACED by `isSanctionedMove`: only the three moves the tooling performs (nested → project-level flat, project-level flat → nested, workstream → archive under the SAME slug and stage) are exempt; restore-from-archive stays blocked (edits made while archived must not launder back). 7 new tests fail against the phase-3 code, so they discriminate. Pre-existing holes (scaffold overwrite, template poisoning, symlinked stage dir, archived outlines unprotected) are not renames and are out of scope: filed as `debug-1ab833` + an INTERVIEW question, committed on main at `35d0862`. Status-log times on 2026-09-21 above are the clock's; this line is the next morning's.

---
hash: 2d6fc1
type: debug
created: 2026-09-02T11:20:00-06:00
title: "A peer session's story commit captured another session's uncommitted workstream-artifact edit"
status: done
owner: /devx-2026-09-21T1236-75585
branch: null
from: dev/dev-dlr103-2026-09-02T09:14-workstream-resolution-flat-guard.md
---
## Goal

`_devx/workstreams/<slug>/plan/agent.md` is a SHARED artifact living on `main`,
and two concurrent `/devx` sessions on sibling phases of one workstream both
write to it (the Phase 6 as-built sync). One session's commit must never carry
another's in-flight prose.

Expected: a story commit contains only that story's own edits.

Actual: commit `3e61e67` — "feat: dlr102 — gate subject resolution through
engine.docs_layout (#152)" — contains an ~28-line `**As-built (dlr103).**`
block describing dlr103's implementation. That text was authored by the dlr103
session as an UNCOMMITTED edit in the main worktree at ~10:50 on 2026-09-02;
PR #152 merged at 10:57.

## Evidence

```
$ git log -S "As-built (dlr103)" --oneline origin/main \
    -- _devx/workstreams/docs-layout-resolution/plan/agent.md
3e61e67 feat: dlr102 — gate subject resolution through engine.docs_layout (#152)
```

The block is verbatim the dlr103 session's first draft (it opens "Two
departures, both narrow" and names `planSpecWorkstreamRel()` /
`workstreamSlugFor()` — symbols that exist only on `feat/dev-dlr103`, and that
`3e61e67` itself does not add).

Consequence observed downstream: PR #153 (dlr103) conflicted on this file, and
the conflict's "theirs" side was dlr103's own earlier prose arriving from
`main`. Resolved by hand — dlr102's phase-2 as-built notes kept in full, the
dlr103 block replaced with the current version (merge commit `1f4aeea`).

## Acceptance criteria

- [ ] AC 1: Repro exists — two sessions, one shared workstream artifact on
      `main`, one with an uncommitted edit; the other's story commit is shown
      capturing it (or shown NOT to, falsifying the current reading).
- [ ] AC 2: The MECHANISM is established with evidence, not inferred. This
      spec deliberately does not name one. The dlr103 session could not
      determine how main-worktree content reached dlr102's *worktree* copy:
      a story commit is made in `.worktrees/dev-<hash>/`, which has its own
      checkout, so a blanket `git add` there should not see a main-worktree
      edit at all. Candidate paths to test, in order of cheapness:
      a Phase 6 as-built sync performed against the MAIN worktree rather than
      the branch (the dlr103 session did exactly this by accident — see its
      status log's CWD-drift entry — so dlr102's may have too, making the two
      edits collide in one file); a `git checkout <branch> -- <path>` or
      cherry-pick pulling main's dirty state; or a rebase/stash step.
- [ ] AC 3: Fix forward structurally, not by a rule agents must remember. The
      `git add -A` incident class already has a structural fix at the
      `finalize` step (stage exactly the pathspecs `mark-done` returns —
      LEARN.md § multi-loop-concurrency E1/E2/E3/E5, erratum `ba3c65b`); this
      recurrence is at a DIFFERENT step, so establish which and close it the
      same way.
- [ ] AC 4: Regression test, and the expectation added to the
      docs-layout-resolution workstream's `evals/` if the surface is one it
      owns — otherwise say so explicitly here.

## Technical notes

The `/devx` Phase 6 as-built rule ("true THIS phase's row in `plan/agent.md`
in the same commit that lands it") and the Phase 2 todo rule ("workstream
artifacts live on main; never edit the worktree's copy") point at DIFFERENT
trees for files in the same directory. That ambiguity is worth resolving in
the skill body regardless of what the repro finds here — it is the most
likely way an agent ends up editing main's copy of an artifact whose change
is supposed to ride a branch.

Filed out of scope by dlr103 (`/devx` Phase 8 step 2): the defect is in
concurrent-session bookkeeping, not in layout resolution.

## Status log

- 2026-09-21T17:05-06:00 — **PR #175's own CI run caught a wrong rule, and a wrong prediction of mine.** I told the coordinator this PR would exercise the non-phase skip path. The CI log shows it did not: the check scoped 2d6fc1 to `ownPhase: 3` in docs-layout-resolution. The split-follow-up rule inherited a parent's phase from `from:` alone, and `from:` records every kind of provenance — this spec was merely FILED from dlr103. Measured: filing never touches the parent (dlr103 has no `spawned:`; no dev spec's `spawned:` names a debug spec), while `devx split` records the follow-up in the parent's `spawned:`. Inheritance now requires the parent's `spawned:` to name the story. No real split parent exists yet, so this corrects a future case, not a past result. Re-run on this branch: `skipped`, exit 0. Regression test added. I found it only because I read the step's log instead of taking the green checkmark as the prediction confirmed.
- 2026-09-21T16:40-06:00 — **the fix's own commit repeated the class it fixes; caught before push.** I staged it with `git add -A`, which swept in 27 paths under `repos/`: temp git repositories a reviewer's scripts created inside this worktree (relative paths resolved against the worktree they ran from). The commit carried 37 files instead of 10. Removed by exact path and amended before any push; the directory is gone and the tree is clean. Worth recording because it is this spec in miniature: a blanket stage picked up another agent's work from a directory it could see, and nothing but reading the file list caught it. Staging by pathspec is the habit that would have prevented it.
- 2026-09-21T16:20-06:00 — phase 4: three-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor), pre-merge. Blind 9, Edge 10, Auditor 4 — about 15 unique after overlap: 1 HIGH, 4 MED, the rest LOW. All fixed, each with a test, then re-verified by replaying the revised check over every plan-touching commit in history (below).
- 2026-09-21T16:15-06:00 — **mechanism established from evidence (AC 2), not inferred.**
  - **Objects.** The published branch commit `ccf1e2a` (squashed as `3e61e67`) is an AMEND. The pre-amend commit `bc92d05` survives as an unreachable object: same parent `e0663e3`, same author time 10:49:34, committer time 10:49:34 vs 10:51:00. It does **not** contain dlr103's block. `git diff bc92d05 ccf1e2a` touches only `plan/agent.md`, adding the "As-built (dlr103)" block AND flipping dlr103's T3.1–T3.6 boxes — exactly the edits dlr103's CWD drift had left uncommitted in main's working copy.
  - **Transcript** (dlr102 session `423845f0-…jsonl`, rows 849/853/857). Working in the MAIN worktree, it ran `git diff -- <plan> > plan-asbuilt.patch` — capturing main's whole working diff of that file, peer edits included — then `git checkout -- <plan>`, which **also discarded dlr103's uncommitted edits from main**; then `git apply` in `.worktrees/dev-dlr102` and `git commit --amend`. So the capture and a silent deletion of the peer's working copy were one operation. Rebase, cherry-pick and `checkout main -- path` are ruled out: no earlier commit anywhere contains the block.
  - **Why it did that** (inference, marked as such): two skill-body instructions conflicted. Phase 2 said "workstream artifacts live on `main`; never edit the worktree's copy" (written for `todo.md`, phrased generally); Phase 6's as-built step says true `plan/agent.md` "in the same commit that lands it", i.e. on the branch. Reconciling them means editing main's shared copy and carrying it over. The session gave no reason; the rule explains it.
- 2026-09-21T16:15-06:00 — **population.** 18 commits on main touch a workstream `plan/agent.md`; exactly 1 captured another story's in-flight work (this one). Wider: of 64 cases where a story commit changed another story's spec, 41 were filings, 13 deliberate cross-references, 8 intentional scope, 2 captures — one is this, the other (`ac0ccf2`, 2026-07-29) the older `git add -A` sweep on a main bookkeeping commit, fixed by scoped staging in August and not recurred since. Rare, but the instruction that produces it was still live.
- 2026-09-21T16:15-06:00 — **fix (AC 3), at two layers.**
  - **Cause removed.** `.claude/commands/devx.md` Phase 2 now says `todo.md` lives on `main`; the as-built step says edit the **worktree's** `plan/agent.md` (not main's — it holds peers' uncommitted work). Net −11 bytes.
  - **Structural guard.** `devx workstream scope-check`: a story's plan edit must stay inside its own phase. Run by devx's own CI on every PR, and by the `devx loop` merge tail — the unattended path every install has — which hands off rather than merging. CI because it is the gate a hand-merge still respects. A per-file pathspec cannot catch this: the captured text is in a file the story legitimately owns, so the rule is on content.
  - **The one exception is measured.** A naive "own phase only" rule also flagged dlr105 (`6747362`), whose only cross-phase change flipped Phase 4's checklist row after dlr104 was already `done` — catch-up, not capture (dlr103 was `in-progress` at dlr102's base). Allowed: an in-place ` `→`x` flip of a checklist row whose phase is done at the base, row text unchanged. Nothing else crosses.
  - **Replay** of the final check over every commit in devx history touching a plan (`git log --all`, both `plan/agent.md` and the flat `plan.md` layout): 15 phase-story commits checked, 1 incident flagged (`3e61e67` and its branch commit `ccf1e2a`), 0 false positives. Three early stories (`hfi101`, `pin101`, `pin102`) edited their plan before specs carried `phase:`; they are reported as unscoped, not failed — failing them would have been false positives on legitimate work.
- 2026-09-21T16:15-06:00 — **AC 4: the surface is NOT owned by docs-layout-resolution.** That workstream is closed and archived (`_devx/archive/docs-layout-resolution/`), and the defect is concurrent-session bookkeeping in the `/devx` skill and the story flow, not layout resolution — as this spec's own Technical notes said. So there is no eval to add there. The regression tests are `test/workstream-plan-scope.test.ts` (AC 1's two-worktree reproduction, a replay of the real `3e61e67`/`6747362` commits, every review finding) and two cases in `test/loop-tail.test.ts`.
- 2026-09-21T16:15-06:00 — **review findings worth knowing.** (1) The first cut would have turned CI red on every legitimate as-built edit in the one live workstream: `usage-window-governor`'s plan writes `### Phase 1 — …` and has no checklist, and the map knew only `### 1. Phase`. My replay missed it because every commit it covered came from one archived workstream with one heading format — zero false positives from a sample of one format was not evidence. (2) The new test file was missing from `SYNC_BLOCKING_TESTS`, which would have failed CI outright. (3) Several paths passed silently: non-phase stories, git errors read as "nothing changed", colour/external-diff config, renames, and a done-phase exception judged per line that let a retitle or a new `[x]` row through. All fixed.
- **Known limits, stated in code:** a story with no `phase:` and no split lineage is warned about, not failed; project-level repos are matched by a root `plan.md` but not otherwise tested here.


- 2026-09-02T11:20 — filed by /devx during dlr103 (PR #153) after the merge
  conflict surfaced it. Mechanism NOT determined; evidence recorded above.
- 2026-09-21T12:36:15-06:00 — claimed by /devx in session /devx-2026-09-21T1236-75585
- 2026-09-22T10:05:55-06:00 — merged via PR #175 (squash → 385f9b8)

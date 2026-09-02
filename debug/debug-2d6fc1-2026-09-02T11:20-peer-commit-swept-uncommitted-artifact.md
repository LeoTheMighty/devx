---
hash: 2d6fc1
type: debug
created: 2026-09-02T11:20:00-06:00
title: "A peer session's story commit captured another session's uncommitted workstream-artifact edit"
status: ready
owner: null
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

- 2026-09-02T11:20 — filed by /devx during dlr103 (PR #153) after the merge
  conflict surfaced it. Mechanism NOT determined; evidence recorded above.

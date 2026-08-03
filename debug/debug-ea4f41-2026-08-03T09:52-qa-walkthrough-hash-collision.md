---
hash: ea4f41
type: debug
created: 2026-08-03T09:52:00-06:00
title: "QA-walkthrough naming `test/test-<story-hash>-…` collides with spec-hash resolution"
from: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md
status: ready
owner: null
branch: null
---

## Goal

`/devx` Phase 5's QA-walkthrough emission step names the file
`test/test-<hash>-qa-walkthrough.md` where `<hash>` is the **story's own
hash**. Reusing the story hash for a second file under a different type dir
breaks the by-hash spec resolver, which requires hashes to be unique across
type dirs. Expected behavior: emitting a walkthrough never makes the story it
documents unresolvable.

## Repro

Observed live on sgr103 (this is how it was found — not a hypothetical):

```
$ devx tour gather sgr103
devx tour gather: tour gather failed at stage 'no-spec': hash 'sgr103'
resolves to 2 spec files (dev/dev-sgr103-…-graph-render-cli.md,
test/test-sgr103-qa-walkthrough.md); spec hashes must be unique across
type dirs

$ devx merge-gate sgr103
devx merge-gate: hash 'sgr103' resolves to 2 spec files (…)
{"merge":false,"reason":"spec resolution failed"}
```

Minimal repro: for any story `<h>` that already has `dev/dev-<h>-*.md`, add
`test/test-<h>-qa-walkthrough.md`, then run `devx merge-gate <h>`.

## Root cause (evidence)

- The resolver keys on the hash segment of the filename and enumerates every
  entry in `SPEC_TYPE_DIRS`, so `dev/dev-<h>-…` and `test/test-<h>-…` are two
  hits for one hash — it fails closed rather than guessing.
- Every pre-existing `TEST.md` entry uses the canonical
  `test/test-<own-hash>-<ts>-<slug>.md` form with a **fresh** hash (verified
  against all five rows in `TEST.md`), so the walkthrough instruction is the
  outlier, not the resolver.

## Blast radius

Blocking, not cosmetic. `devx merge-gate <hash>` is `/devx` Phase 8's gate, so
a story that emits a walkthrough under the colliding name cannot be merged by
the skill at all — it returns `{"merge":false,"reason":"spec resolution
failed"}`. `devx tour gather` (Phase 7.5) fails the same way. Both surface
*after* the work is committed and pushed, which is the worst place to find it.

## Acceptance criteria

- [ ] AC 1: Phase 5's emission step names the walkthrough with its own fresh
      hash in canonical spec form (`test/test-<new-hash>-<ts>-<slug>.md`),
      matching every existing `TEST.md` row, in both
      `.claude/commands/devx.md` and the `skills/` mirror.
- [ ] AC 2: The emitted walkthrough carries canonical frontmatter (`hash`,
      `type: test`, `created`, `title`, `from:` the story spec, `status`) so
      it indexes like every other spec rather than as a bare markdown file.
- [ ] AC 3: A regression test asserts no two files across `SPEC_TYPE_DIRS`
      share a hash — this class is currently caught only at the moment
      someone runs a by-hash CLI.

## Technical notes

- Found during sgr103 (PR #112). Worked around there by renaming to
  `test/test-97f6d8-2026-08-03T09:50-sgr103-qa-walkthrough.md`; the story's
  own merge was unblocked by the rename, so nothing is on fire.
- The Phase-5 emission step was **uncommitted work-in-flight** in the main
  worktree when sgr103 ran (`_devx/templates/engine/qa-walkthrough.md`,
  `.claude/commands/devx-test.md`, and the `devx.md` Phase-5 edit were all
  untracked/modified). Whoever lands that change owns this fix; this row
  exists so the finding is not lost in the handoff.
- AC 3 is the durable fix — the naming convention can drift again, but a
  uniqueness assertion cannot be forgotten.

## Status log

- 2026-08-03T09:52 — filed from sgr103 (PR #112) after `devx tour gather` and
  `devx merge-gate` both failed to resolve the story's own hash.

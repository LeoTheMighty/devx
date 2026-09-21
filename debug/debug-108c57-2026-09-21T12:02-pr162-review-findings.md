---
hash: 108c57
type: debug
created: 2026-09-21T12:02:00-06:00
title: "Fix forward the retroactive review of PR #162 (828385's frontmatter primitive)"
from: debug/debug-828385-2026-09-20T10:06-claim-splices-duplicate-owner-key.md
spawned: []
status: in-progress
owner: /devx-2026-09-21T1203-41728
branch: null
---

## Goal

PR #162 (`828385`, merged `6b8684bd`) introduced `src/lib/frontmatter-keys.ts`,
a shared upsert primitive for spec frontmatter, and routed the claim,
mark-done, verify-claim and doctor paths through it. It merged without the
Phase 4 adversarial review CLAUDE.md makes non-skippable, along with seven
other PRs the same day. This spec carries the retroactive review's findings.

Review shape: **three agents in parallel** — Blind Hunter (diff only, no
spec), Edge Case Hunter (adversarial inputs against the real code, plus a
scan of all 319 spec files in devx and palateful), Acceptance Auditor
(every AC against the diff). Retroactive and post-merge. Every finding
below carries a repro the reviewer ran; the MED ones were then reproduced
again independently with fresh scripts, per `plan-4c827d`'s rule that a
re-check only counts if it could have disagreed.

**Blast radius today is small.** The Edge Case Hunter's corpus scan found
none of the broken shapes in any real spec, so nothing is corrupted now.
These are defects waiting for the first file or writer that reaches them —
which, for a primitive every writer depends on, is the point of reviewing
it.

## Acceptance criteria

Writers that bypass the primitive (AC 7a said "every writer"):

1. `manage/loop.ts:602` `replaceFrontmatterStatus` goes through
   `upsertFrontmatterKey`. Today `/^(status:\s*)\S+(.*)$/m` lets `\s*`
   cross the newline after a bare `status:` and overwrite the next line:
   `status:\nowner: /devx-me` becomes `status:\nblocked /devx-me` — the
   `owner:` key is destroyed and the caller reports success. Used by the
   max-restarts path and by `devx loop`'s abandon path via
   `loop/spec-io.ts:setSpecStatus`.
2. `devx/split.ts:519` `patchParentSuperseded` goes through the primitive.
   Its `/^owner:/` also matches `ownership:` (rewriting it to
   `owner: null`), and its `status:` scan is last-wins.
3. `loop/spec-io.ts:222` `clearSpecOwner` removes every `owner:` line, not
   only the first.

Readers with the bare-key defect (AC 5):

4. `plan/validate-emit.ts:856` `parseFrontmatterValue` stops reading the
   next line for a bare key. Its `^key:\s*(.*)$` with the `m` flag lets
   `\s*` cross the newline: bare `owner:` reads `"branch: feat/x"`. Live in
   `devx next` (`next/gather.ts:764`) and validate-emit's own checks.

Regression introduced by #162:

5. A closing fence with trailing whitespace (`--- `) is accepted again.
   Delegating to `engine/frontmatter.ts:splitFrontmatter` made every
   migrated reader and writer treat such a spec as having no frontmatter
   (`updateSpecForClaim` throws; doctor reads "no owner"); the per-site
   regexes it replaced accepted it. An empty block (`---\n---`) is
   accepted too — not a regression, but the same regex.

Success reported for work not done (the coordinator's fourth question):

6. `loop/spec-io.ts:211` `setSpecStatus` stops using a whole-file
   `content.includes("status: X")` as its success check. A spec with no
   frontmatter `status:` whose body contains `status: done` returns true
   with the file unchanged. Check the frontmatter value instead.
7. `doctor/fix.ts` stale-lock repair stops recording "removed the stale
   lock" in the spec's audit line when the lock was already gone
   (`reason === "missing"`). The outcome was right; the append-only record
   claimed an action that did not happen.

The primitive itself — convergent across all three reviewers:

8. Deleting a duplicate key also deletes its indented continuation lines.
   Today only the header line goes, and the children attach to the
   preceding key: invalid YAML for a nested mapping, and **silent data
   corruption** for a block scalar (`owner: |\n  a\n  b` after a
   `title: t` parses as `title: "t a b"`).
9. Replacing a key that heads a nested mapping or multi-line value with a
   scalar **refuses** (throws) rather than orphaning the children. A
   generic primitive must not silently corrupt the first caller that
   targets `gate_status:` or `outcome:`.
10. `afterKey` inserts after the anchor's continuation block, not between
    the anchor and its own children.
11. Keys YAML treats as the same key are recognized: `"owner":`,
    `'owner':`, `owner :`. Today they miss, so upsert inserts a second
    `owner` (the exact defect 828385 set out to close, by another
    spelling), and `duplicateFrontmatterKeys` does not see the pair.

Surfacing (AC 4 of 828385):

12. `devx devx-helper verify-claim` actually reports `specDuplicateKeys`.
    It is computed and never emitted by the CLI (`devx-helper.ts:541-590`),
    so "surfaced rather than swallowed" holds one layer in and fails at
    the layer anyone reads.
13. With duplicate `owner:` keys, verify-claim prefers the first
    **non-empty** value rather than the first line. First-wins was
    justified by "the authoritative value sits above the stale key", which
    is true only for one key order. Across 292 real specs 0 put `owner:`
    before `status:`, so this changes nothing today — it removes the order
    dependence instead of relying on it.

AC 7b of 828385:

14. The validator's second rule ships: `owner:` must be YAML null or a
    `/devx-` session token; `owner:` and `branch:` are never bare. The
    duplicate-key rule already exists. Tests for both.
15. The rule reaches the population it was written for. Today it runs only
    in `devx plan-helper validate-emit <epic>`, only over that epic's
    `dev/` specs — so the hand-authored `debug/` specs the spec names are
    never checked. Add a report-only `devx doctor` finding over every spec
    directory.

Tests the audit found missing:

16. Tests for the mark-done bare-`status:` path and the doctor bare-`status:`
    fix, plus a regression test for each item above.
17. Full suite green; `npm run typecheck` clean.

## Technical notes

### Two claims in 828385 were wrong, and neither was caught before merge

- **The HALT never happened in devx.** 828385's §Goal says a claim on a
  bare-owner spec made `/devx` Phase 1 HALT on an ownership mismatch
  against the legitimate owner. The pre-fix `verify-claim` decides
  ownership **only from the lock** (`6b8684bd^:verify-claim.ts:335`). The
  spec's `owner:` fed only `specOwnerDrift`, an advisory flag that never
  changed the exit code, and an empty owner normalizes to null, so even
  that stayed false. The duplicate key was real; the severity was
  invented. palateful's build could differ and was not checked.
- **"doctor reported a fix it had not made" is inaccurate.** The old code
  (`6b8684bd^:fix.ts:366`) pushed "reset the spec" only when the text
  changed. On a bare `status:` it silently *omitted* the reset while
  returning `ok: true` — an omitted step, not a false claim. Item 7 is the
  case that really is a false claim.

Both are corrected in 828385's status log.

### AC 7b's second rule cannot be fully enforced for `branch:`

As written it says `branch:` must be "a valid value of its type". But
`unassigned` — the sentinel that motivated it in `debug-1dfbdd` — is a
syntactically valid git ref name, so no shape check can reject it. For
`branch:` the validator can reject bare, and nothing more. Detecting a
sentinel branch needs the reader to check that the branch exists, which is
`debug-1dfbdd`'s AC 1, not a frontmatter rule. Recorded rather than
papered over.

### Out of scope, filed as follow-up

Not taken here, because they are older than #162 or belong to another
story's surface:

- Readers disagree on value normalization: `branch` strips trailing
  comments and quotes, doctor's `ownerOf` strips quotes only,
  verify-claim strips neither. `owner: /devx-S  # note` reads as a
  mismatch. Pre-existing; no real file has it.
- `merge-gate.ts:138 readFrontmatter` is last-wins and not
  CRLF-tolerant, so it disagrees with verify-claim on a duplicated
  `status:`. merge-gate is `debug-1dfbdd`'s surface.
- A claim on a CRLF spec leaves mixed line endings (frontmatter LF, body
  CRLF). Not a regression.
- validate-emit's fence regex stops at a `---` inside a title. No real
  title contains one.

## Status log

- 2026-09-21T14:41-06:00 — phase 4: self-review of this fix = three-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor), pre-merge; ~16 unique findings (0 HIGH, 2 MED from the Edge Case Hunter + 1 MED from the Auditor, rest LOW), all fixed, then re-verified by targeted tests for each finding plus an empirical real-corpus leg (new vs origin/main writers and readers over 320 real specs: 0 differences). Details below.
- 2026-09-21T14:40-06:00 — **implemented; two rounds of three-agent
  review on the fix itself** (Blind Hunter + Edge Case Hunter + Acceptance
  Auditor in parallel, both rounds). This PR changes the same shared
  primitive #162 did, so it got the review #162 skipped.
  - Round 1 on the fix: Edge 5, Blind 6, Auditor 12; about 16 unique after
    overlap, 0 HIGH. The ones that mattered: (a) the scalar-overwrite
    refusal added in item 9 THREW on `status: ready` followed by an
    indented comment — a regression on input every writer used to handle;
    (b) the empty-block support claimed in item 5 swallowed body text up to
    a later `---` rule (greedy optional group; fixed with `??`); (c)
    `keyBlockEnd` missed a column-0 comment inside a value and a compact
    sequence under a bare header; (d) doctor's owner reader and
    verify-claim resolved duplicates differently, so doctor's own message
    was false; (e) doctor's `malformed-frontmatter` detail never named the
    file. All fixed, each with a test.
  - Round 2 = targeted tests for every round-1 finding plus an empirical
    real-corpus leg: the new and the pre-change (`origin/main`) loop
    writer, doctor writer and `parseSpecClaimFields` run over all 320 spec
    files in devx + palateful, three status values each — **0
    differences**. `malformed-frontmatter` reports 0 on both repos, and
    fires on a temp repo seeded with the shapes (negative control).
  - The three regression tests in existing files (items 7, 12, 13) were
    run against unfixed `main` and fail there, and only there.

  **Corrections to this spec's own claims:**
  - **Item 2/3's `ownership:` claim is false.** `/^owner:/` never matched
    `ownership:` — the colon must follow `owner` directly. It came from the
    first review of #162; I wrote it into the ACs, two code comments and a
    test without running the one-line check. The test is kept as a guard,
    relabelled as such; item 2's real regression is the last-wins
    `status:` rewrite, which fails on `main`.
  - **Item 13's "292" is wrong.** Re-measured by parsing frontmatter: 223
    specs carry both `owner:` and `status:`, and 0 put `owner:` first.
  - **Item 14 was narrowed, deliberately.** It asked that `owner:` be null
    or a `/devx-` token. Measured by two methods (an awk scan, then
    `splitFrontmatter` + the `yaml` package): 23 of 223 real owner values
    are neither — 19 bare `/devx`, 2 `interactive-session-…`, 1 human
    session label, 1 `unassigned` — and most are legitimate. Ownership is
    decided from the lock, so the rule would flag noise with no hazard
    behind it. Shipped instead: duplicate keys, and a bare (or
    comment-only) `owner:` / `branch:`. The `branch:` sentinel case cannot
    be caught by shape and stays with `debug-1dfbdd`'s reader.

  **Kept as known limits, stated in code:** a multi-line flow value whose
  continuation starts at column 0 is not treated as part of its key; a
  duplicate pair whose FIRST copy heads a block refuses, while one whose
  LATER copy does is deleted with its lines (converging on the first copy).
  Neither shape exists in either repo.


- 2026-09-21T12:02-06:00 — filed from the retroactive three-agent review of
  PR #162. Blind Hunter 4 findings, Edge Case Hunter 7, Acceptance Auditor
  11; about 16 unique after overlap. The four MED findings in items 1, 4,
  5 and 6 were re-reproduced with fresh scripts; items 7, 12 and the two
  828385 corrections were re-confirmed by reading the code.
- 2026-09-21T12:03:23-06:00 — claimed by /devx in session /devx-2026-09-21T1203-41728

## Links

- Reviewed: PR #162, `debug/debug-828385-…` (merged `6b8684bd`).
- `debug/debug-1dfbdd-…` — shares AC 7b's rule; owns the `branch:`
  sentinel.
- `plan/plan-4c827d-…` — items 6 and 7 are specimens of its
  "reported an action that did not happen" shape.

---
hash: 828385
type: debug
created: 2026-09-20T10:06:00-06:00
title: "Claim splices a duplicate owner: key into a bare-owner spec, and verify-claim then reads the empty one"
from: null
spawned: []
status: in-progress
owner: /devx-2026-09-20T1808-45652
branch: null
---

## Goal

`updateSpecForClaim` (`src/lib/devx/claim.ts:481`) detects the existing
`owner:` frontmatter key with `/^owner:\s/`, which **requires a
whitespace character after the colon**. A bare `owner:` at end-of-line
has none, so `ownerIdx` stays `-1`, the insert branch runs, and the claim
splices a *second* `owner:` key in beside the first.

The trigger is the frontmatter **shape**, not the spec type. It was
reported as a `--type debug` bug (palateful-0e hit it claiming `imptb1`
and deduped by hand).

Precisely: **`updateSpecForClaim` does not branch on type.** The owner
splice is type-blind, so frontmatter shape decides it, not `debug/` vs
`dev/`.

(An earlier draft said "nothing in the claim path branches on type."
That is **false** and was corrected 2026-09-20 — the claim path branches
on type in at least six places: `claim.ts:566` `opts.type ?? "dev"`,
`:567` the claimable-type check, `:573` `BACKLOG_BY_TYPE`, `:604`
`deriveBranch`, `:684` the resolve glob, and `flipDevMdRow`'s row
pattern at `:417`. Only the frontmatter rewrite is type-blind, and that
is the narrower claim this story actually needs.)

Every `owner:` in this repo's own `debug/` specs is `owner: null`, which
matches `\s` and replaces correctly — which is exactly why devx has never
seen it fire on itself. Any spec of any type authored with a bare
`owner:` hits it.

### Reproduced

Against `ce88a36`, calling `updateSpecForClaim` directly:

| existing line | `owner:` keys after claim |
|---|---|
| `owner:` | **2 — duplicate** |
| `owner: null` | 1 |
| `owner: ` (trailing space) | 1 |
| `owner:  ` (two spaces) | 1 |

### The consequence is worse than a cosmetic duplicate

The new owner is spliced at `statusIdx + 1`. In the canonical template
order (`status:` then `owner:`) that lands the real owner *above* the
stale bare key, leaving the empty one **last**:

```yaml
status: in-progress
owner: /devx-2026-09-20T1000-111
owner:
branch: null
```

`verify-claim` (`src/lib/devx/verify-claim.ts:213`) scans lines and
reassigns on every `/^owner:\s*(.*)$/` hit — **last match wins** — so it
reads the owner as `""`.

Per CLAUDE.md, `/devx` Phase 1's resume-detection branch runs `devx
devx-helper verify-claim <hash> --session-token …` and **HALTS on an
ownership mismatch**. So a claim against a bare-owner spec silently
poisons its own resume path: the roc101 safety check, which exists to
stop a fresh session stomping a live peer, fires against the legitimate
owner instead. The hand-dedupe in palateful repaired the symptom before
this surfaced.

**The severity is compositional, and that decides where to fix it.** A
bare key on its own is valid YAML that every reader handles. An
appending writer on its own is harmless against well-formed frontmatter.
Only together do they produce the duplicate key, the last-wins `""`, and
the HALT. Either half alone is survivable — which is why the fix belongs
on the **writer** (AC 7a): making the append impossible removes the
lethality regardless of what anyone types, whereas policing the data
only holds until the next bare key is typed by hand.

This is the `debug-9f24c7` / `debug-7b3e2a` family — a hand-rolled
frontmatter parser disagreeing with YAML about a degenerate value — and
it has the same eventual hazard: duplicate keys parse one way under the
current hand-rolled readers and another way under any real YAML library,
so a dependency bump can silently flip which owner wins.

## Acceptance criteria

1. `updateSpecForClaim` recognizes a bare `owner:` key and **replaces**
   it. No path splices a second `owner:` into frontmatter that already
   has one. Regression test drives all four shapes in the table above.
2. The same latent defect on the sibling line is fixed: `statusIdx` uses
   `/^status:\s/`, so a bare `status:` leaves `statusIdx === -1` and the
   function throws `"frontmatter missing \`status:\` line"` on a spec
   that plainly has one. Test both keys.
3. A spec that *already* carries duplicate `owner:` keys (written by the
   current code, in the wild) converges to a single key on the next
   claim rather than growing a third. Test.
4. `verify-claim`'s last-match-wins loop is made deliberate rather than
   incidental — either first-wins with a documented reason, or an
   explicit refusal when a spec carries duplicate keys. Do not leave the
   resolution implicit; a silent wrong answer here HALTS a legitimate
   resume.
5. Audit the other hand-rolled frontmatter readers for the same
   `:\s`-vs-`:\s*` defect and fix what shares it. Known: `doctor/
   detect.ts:106` uses `/^owner:\s*(.+?)\s*$/m` — `\s*` is right, but
   `.+?` requires a character, so a bare key reads as absent, and the
   `m` flag is not anchored to the frontmatter block, so an `owner:`
   line anywhere in the body can match. Decide and pin both.
6. **A key match must be BLOCK-SCOPED to the frontmatter, and
   line-anchored.** Scoping is the load-bearing half. Demonstrated live
   on 2026-09-20: a cross-repo scan (`grep -rl '^owner:$'` — correctly
   anchored) flagged THIS file as carrying a bare `owner:` key. It
   matched line 49 — inside the fenced ```yaml repro block in the story
   BODY, not the frontmatter. Anchoring was never the problem, so an
   anchor-only rule would not have caught it. A spec *about* frontmatter
   keys will always contain frontmatter-shaped lines in its body, and
   this one does by construction.
   Require both: parse strictly between the opening `---` and the
   closing `---`, ignore everything after, and anchor within that block.
   Tests: (a) a bare `owner:` in a fenced body block must not be seen;
   (b) `owner:` inside a quoted `title:` value must not be counted — the
   frontmatter block of this spec holds 2 substring occurrences of
   `owner:` and exactly 1 line-anchored key, so an unscoped *or*
   unanchored reader is wrong in a different way.
7. **Close the re-seed path.** ACs 1-4 fix the write path and clean
   existing corruption, but nothing stops the next hand-authored spec
   from reintroducing a bare key. Every machine authoring site already
   emits `owner: null` (`split.ts:406`, `split.ts:530`,
   `learn/propose.ts:208`, `gather.ts:434`), so there is no emitter to
   fix — the exposed population is hand-authored specs, which means the
   durable control is **one shape-agnostic write primitive**, and a
   validator that rejects only what is genuinely invalid. The two halves
   were fused in an earlier draft of this AC; they are separate.

   **7a — the write path (this is the real fix).** Add
   `upsertFrontmatterKey(fmLines, key, value)`: one primitive whose
   replace branch matches BOTH `^key:\s*$` and `^key:\s+…`, so bareness
   can never route to insert. Every frontmatter writer goes through it.
   A future key that acquires a writer then inherits correctness instead
   of re-opening the hole — which is the anti-enumeration property this
   AC was reaching for, sited where it actually holds.

   **7b — the validator.** Two rules, both narrow enough to survive the
   bare-key objection below:
   - **Duplicate keys** — unambiguously wrong in any YAML, reject
     always.
   - **`owner:` and `branch:` specifically must be YAML `null` or a
     valid value of their type** — never bare, never an unrecognized
     sentinel. Deliberately keyed to two fields rather than applied to
     frontmatter generally, which is what lets it coexist with bare
     `gate_status:` / `outcome:` / `gate_verdicts:`. It also catches
     `debug-1dfbdd`'s `unassigned` from the value side, so one rule
     closes both stories' data halves.

   Natural home: `plan/validate-emit.ts`, which already owns
   `spec-missing-branch-frontmatter`. 7b is **complementary to 7a, not
   an alternative** — 7a makes the class impossible going forward, 7b
   catches data before it reaches any writer that predates 7a.

   ⚠️ **7b is a SHARED control with `debug-1dfbdd`.** The same rule
   closes this story's bare-`owner:` half and 1dfbdd's `unassigned`
   half. Narrowing it, re-keying it to different fields, or relaxing
   which values count as valid weakens BOTH stories — check 1dfbdd
   before changing it, and say so in the PR body.

   **A bare key is NOT a defect and must stay legal.** `key:` with
   nothing after it is conventional YAML for a nested mapping or an
   empty value, and devx's own plan-spec template depends on it:
   measured 2026-09-20, **14 of 25 `plan/` specs** carry bare
   `gate_status:` / `outcome:` / `gate_verdicts:` / `spawned:`, including
   `plan-4c827d` — the spec that argues for this validator. Rejecting
   bare keys generically would outlaw the repo's own template. The data
   is fine; the regex editing it was wrong.
8. Full suite green; `npm run typecheck` clean.

## Technical notes

The one-character fix (`\s` → `\s*`) is necessary but **not sufficient
on its own** — AC 3 and AC 4 cover specs already corrupted in the wild,
which a write-path fix alone leaves broken.

Deliberately filed as its own debug item rather than folded into
`dev-f83b04`. It shares a file with that story's call site, which is
proximity, not common cause: f83b04 is a liveness-model design change,
this is a regex defect with a mechanical fix. Bundling them would put a
one-line correction behind a design decision.

### Files

- `src/lib/devx/claim.ts:469-507` — `updateSpecForClaim`; the `\s`
  detectors at :483-484.
- `src/lib/devx/verify-claim.ts:213` — the last-wins owner loop.
- `src/lib/doctor/detect.ts:106` — sibling reader (AC 5).
- `test/devx-claim.test.ts`, `test/devx-verify-claim.test.ts`.

## Status log

- 2026-09-20T10:06-06:00 — filed. Reproduced against `ce88a36` by
  calling `updateSpecForClaim` directly across four `owner:` shapes; the
  verify-claim consequence was confirmed by replaying its parse loop over
  the produced frontmatter. Reported by the coordinator session
  `leonidbelyi-41` (originating tab palateful-0e, claiming `imptb1`) as a
  `--type debug` bug; the type attribution is **incorrect** — the trigger
  is a bare `owner:` key, and this repo's debug specs escape it only
  because they all use `owner: null`.
- 2026-09-20T10:12-06:00 — a cross-repo scan reported THIS spec as
  carrying a bare `owner:` key, i.e. as unworkable by the defect it
  documents. **Checked and false.** Line 9 is `owner: null`; a
  line-anchored scan of `dev/`, `debug/` and `plan/` finds no bare
  `owner:` key anywhere in this repo. Replaying `updateSpecForClaim`
  against the real file yields 1 owner key and `verify-claim` reads the
  correct token. The scan matched the **substring** `owner:` inside this
  spec's quoted `title:` — the frontmatter block holds 2 substring
  occurrences and 1 line-anchored key. Turned into AC 6 rather than
  discarded: the false positive is a live demonstration of the hazard
  the reader audit is for. AC 7 added from the same exchange (the
  re-seed path), with the scan of authoring sites showing every machine
  emitter already writes `owner: null`.
- 2026-09-20T11:05-06:00 — **AC 7 rewritten; its earlier text was
  wrong.** palateful-2d found that "reject any bare frontmatter key"
  would red-flag 14 of devx's own 25 plan specs — verified here: bare
  `gate_status:` / `outcome:` / `gate_verdicts:` / `spawned:` are
  conventional YAML for nested mappings and empty values, and
  `plan-4c827d` (the spec arguing for the validator) is itself one of
  the 14. Two properties had been fused: duplicate keys are always
  invalid and belong to a validator; bare keys are valid and
  load-bearing. The splice is not caused by bareness being wrong — it is
  caused by a WRITER using a detector stricter than the YAML it edits.
  So the anti-enumeration control moves to the write path as
  `upsertFrontmatterKey` (7a), and the validator keeps only
  duplicate-key rejection (7b). 2d's reading, adopted over the literal
  text.
  Also from 2d: **AC 3's live population is zero** — `imptb1` was
  repaired at `65d4d75a` (PR #26), traced per-revision
  (`0aff93a7`=1 → `36a2372b` claim =2 → `65d4d75a`=1), so the wild
  instance is historical and AC 3 needs a synthetic fixture. (An
  entry here claiming the re-seed path was a **template/emitter** is
  **retracted** — see the 11:20 line below. It never reached the ACs.)
- 2026-09-20T11:20-06:00 — **emitter claim retracted.** palateful-0e
  audited every spec in that repo's `dev/` and `debug/`: six carried
  bare keys (`fxfuse`, `fltpin1`, `xcstart1`, `tfship1`, `iosdt1`,
  `iosbump1` — all repaired at `248e939e`, re-audit clean), and **all
  six were hand-authored by one session today**. 0e copied `imptb1`'s
  pre-claim frontmatter when filing `fxfuse`, then reused its own file
  five more times. Every other spec in that repo uses `owner: null` or
  omits the key. So there is no emitter and no propagating template —
  one author, one bad copy. This story's ORIGINAL scoping ("the exposed
  population is hand-authored specs", AC 7) was correct and stands;
  7a's write-path siting rests on the anti-enumeration property and the
  composition argument, never on a population, so nothing relocates.
  **Recorded as a near-miss, not a clean outcome:** the claim stayed to
  one line because 7a's justification had already been written before it
  arrived, not because it was handled well. Had it landed an hour
  earlier it would have become the AC's rationale. Nothing else in this
  artifact would show that, which is why it is here.
- 2026-09-20T11:20-06:00 — **severity is compositional** (same audit,
  now in §Goal): a bare key alone is valid YAML every reader handles,
  an appending writer alone is harmless against well-formed
  frontmatter. Only together do they produce the duplicate key, the
  last-wins `""`, and the HALT. Better argument for 7a's siting than
  anti-enumeration, because it names which half makes the other lethal.
- 2026-09-20T10:45-06:00 — two corrections from palateful-2d, who read
  the source independently. (a) "Nothing in the claim path branches on
  type" is **false** — it branches in six places; only
  `updateSpecForClaim` is type-blind, and that is the claim this story
  needs. Narrowed in §Goal. (b) 2d is **not** the witness and `lgort1`
  is **not** an instance (it carries `owner: unassigned`, whitespace
  present, so it replaced rather than spliced); 2d hit the
  `stage: resolve` failure, which is `debug-7d96be`. The witnessed
  instance remains `imptb1` via palateful-0e. Recorded under §Provenance
  so nobody verifies against an unaffected file.
- 2026-09-20T10:20-06:00 — **the 10:12 diagnosis above was wrong in its
  mechanism**, corrected by the reporting session. The scan was
  `grep -rl '^owner:$'`: correctly line-anchored, and it matched line 49
  of this file — the bare key inside the fenced ```yaml repro block in
  the BODY — not the title substring. The false positive was real; the
  cause was **absent block-scoping**, not absent anchoring. AC 6
  rewritten accordingly: scoping is the control that would have caught
  it, anchoring alone would not. The title-substring case is retained as
  a second test only.
  Same exchange confirmed the defect **in the wild on a second repo**:
  palateful's `imptb1`, block-scoped count = 2 line-anchored `owner:`
  keys, in exactly the predicted layout (real owner at `statusIdx + 1`,
  stale bare key below it, last-wins read returns `""`). Claimed 09:58
  and hand-deduped in PR #26; `main` carries both keys until it merges.
  The spec was authored ~7 weeks before this story existed. AC 7
  generalized from that spec's bare `branch:` key.

### Provenance of the in-the-wild instance

The witnessed instance is **`imptb1`** (palateful-0e), measured by the
coordinator session with a block-scoped count: 2 line-anchored `owner:`
keys in its frontmatter, real owner at `statusIdx + 1`, stale bare key
below it, in exactly the layout this story predicts.

**`lgort1` is NOT an instance**, and palateful-2d is not the witness —
both were asserted in a dispatch and both are wrong. `lgort1` carries
`owner: unassigned` (whitespace present), so it took the *replace*
branch and never spliced; 2d's actual encounter was a `stage: resolve`
rollback ("no spec file found at dev/dev-lgort1-*.md"), which is
`debug-7d96be`, a different bug at a different stage. Two separate
defects were merged into one narrative upstream; this story owns only
the splice.

The ACs rest on source, not on testimony, so the corrected provenance
changes nothing about the fix — but a spec that miscredits its witness
invites someone to "verify" against a file that was never affected.
- 2026-09-20T18:08:12-06:00 — claimed by /devx in session /devx-2026-09-20T1808-45652

## Links

- Reported by: coordinator session `leonidbelyi-41`, 2026-09-20.
- `debug/debug-9f24c7-2026-08-05T12:20-unparseable-spec-frontmatter-silent.md`
  and `debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md`
  — same class: hand-rolled frontmatter parser vs a degenerate YAML value.
- `dev/dev-f83b04-2026-09-20T09:58-spec-lock-holder-liveness.md` — same
  claim path, unrelated cause.
- 2026-09-20T18:05-06:00 — phase 2/3: implemented. New module
  `src/lib/frontmatter-keys.ts` is the AC 7a primitive —
  `splitFrontmatter` / `renderFrontmatter` (block scoping),
  `findFrontmatterKeys` / `frontmatterKeyValue` (shape-agnostic read via
  `^key:(?=\s|$)`), `upsertFrontmatterKey` (replace-first-and-delete-the-rest,
  so ACs 1 and 3 are the same code path), `duplicateFrontmatterKeys`.
  Writers routed through it: `claim.ts` `updateSpecForClaim` (AC 1 + AC 2),
  `mark-done.ts` `updateSpecForDone`, `doctor/fix.ts`
  `replaceFrontmatterStatus`. Readers fixed: `doctor/detect.ts` `ownerOf`
  and the `branch:` read at :712 (AC 5), `verify-claim.ts`
  `parseSpecClaimFields` (AC 4). Validator added in
  `plan/validate-emit.ts` as `spec-duplicate-frontmatter-key` (AC 7b).
  **AC 5 surface was larger than the spec's Files list.** Two more sites
  carried the identical `:\s`-vs-`:\s*` defect and were not listed:
  `mark-done.ts:257` (`/^status:\s/` — a bare `status:` made it throw
  "frontmatter missing `status:` line" on a spec that had one, same shape as
  AC 2 but in the close path rather than the claim path) and
  `doctor/fix.ts:79` (`/^status:[ \t]*\S.*$/m` — the `\S` requires a
  non-space character, so a bare `status:` was silently not replaced and
  doctor reported a fix it had not made). Both fixed.
  **AC 4 resolved as first-wins, not refusal.** In every instance of this
  corruption the authoritative value is the one claim wrote, and claim wrote
  it ABOVE the stale key — so first-wins reads the corrupted population
  *correctly*, where refusing would halt a legitimate resume over a stray
  key and so reintroduce the exact harm the fix removes. The duplication is
  still surfaced, via `SpecClaimFields.duplicateKeys` and
  `VerifyClaimResult.specDuplicateKeys` alongside the existing
  `specOwnerDrift` / `specStatusDrift` signals.
- 2026-09-20T18:20-06:00 — phase 4: single-pass adversarial review; 2
  findings (0 HIGH, 2 MED), both fixed in place.
  (1) `duplicateKeys` was dangling — added to `SpecClaimFields` and tested,
  but no caller consumed it, so a corrupt spec still reached the operator
  silently. That is half of AC 4 missing, not a style nit: "resolve
  deliberately" without surfacing is still an implicit resolution. Wired
  through to `VerifyClaimResult` as `specDuplicateKeys` on both the `owned`
  and `in-progress-without-lock` variants, which is where the sibling drift
  signals already live.
  (2) `duplicateFrontmatterKeys` used `^([^\s:#][^:]*):(?=\s|$)`, which
  reads a column-0 YAML list item (`- foo: bar`) as a key named `- foo` —
  the same reader-disagrees-with-YAML class this story exists to end, newly
  introduced by the fix for it. Tightened to
  `^([A-Za-z_][A-Za-z0-9_.-]*):(?=\s|$)` and validated against every
  top-level frontmatter key in devx + palateful (168 distinct, 0 missed),
  so the tightening is measured rather than assumed. Regression test added.
  Also checked and cleared: `afterKey` anchor resolution in claim (status is
  upserted first and throws if absent, so the anchor always exists);
  `renderFrontmatter` round-trips an untouched spec byte-for-byte;
  `ownerOf`'s nullish-before-quote-strip ordering now matches
  `frontmatter-scalar.ts`'s documented contract, which is a deliberate
  behaviour change (`owner: "null"` is the string `null` per YAML) and is
  the whole point of debug-7b3e2a.
- 2026-09-20T18:30-06:00 — phase 5: `npm test` (which also runs
  `npm run build` + `tsc --noEmit`) — **3315 passed, 1 failed**. The single
  failure is `test/workstream-migration-integrity.test.ts` asserting
  `slugs.length >= 9` against a `_devx/workstreams/` that now holds 1 entry.
  **Pre-existing and unrelated**: reproduced on a clean `main` worktree with
  an empty working tree before any of this work was applied. Filed as
  `debug/debug-09451f-...-workstream-integrity-test-red-on-main.md` + DEBUG.md
  row rather than fixed here — it is an archiving-drift guard, not a
  frontmatter defect, and folding it in would put a one-line correction
  behind an unrelated judgment about what the floor should be.

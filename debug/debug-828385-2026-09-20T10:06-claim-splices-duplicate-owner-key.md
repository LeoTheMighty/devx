---
hash: 828385
type: debug
created: 2026-09-20T10:06:00-06:00
title: "Claim splices a duplicate owner: key into a bare-owner spec, and verify-claim then reads the empty one"
from: null
spawned: []
status: ready
owner: null
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
   durable control is a **validator**, not a writer change. Add a
   structural check (natural home: `plan/validate-emit.ts`, which
   already owns `spec-missing-branch-frontmatter`) that rejects **any**
   bare frontmatter key and **any** duplicate frontmatter key —
   generically, not by enumerating `owner:` and `status:`. Confirmed
   need: palateful's `imptb1` carries a bare `branch:` key on line 10
   alongside the duplicated `owner:` pair. `branch:` happens to be safe
   from *this* splice (claim never writes it; the three readers at
   `verify-claim.ts:223`, `split.ts:905`, `detect.ts:712` all use
   `\s*`), but enumerating keys means the next key to acquire a writer
   re-opens the hole silently.
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

## Links

- Reported by: coordinator session `leonidbelyi-41`, 2026-09-20.
- `debug/debug-9f24c7-2026-08-05T12:20-unparseable-spec-frontmatter-silent.md`
  and `debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md`
  — same class: hand-rolled frontmatter parser vs a degenerate YAML value.
- `dev/dev-f83b04-2026-09-20T09:58-spec-lock-holder-liveness.md` — same
  claim path, unrelated cause.

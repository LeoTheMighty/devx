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
and deduped by hand), but nothing in the claim path branches on type.
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
6. **A key match must be line-anchored, never a substring.** A `title:`
   value can legitimately contain the text `owner:` — this very spec's
   title does — so any check that counts `/owner:/` occurrences rather
   than `/^owner:/` lines reports a phantom duplicate. Demonstrated live
   on 2026-09-20: a cross-repo scan flagged THIS file as carrying two
   `owner:` keys; the frontmatter block has 2 substring occurrences and
   exactly 1 line-anchored key, and claiming it produces a single
   correct owner. Every reader and every validator touched by this story
   gets a test with `owner:` embedded in a quoted `title:`.
7. **Close the re-seed path.** ACs 1-4 fix the write path and clean
   existing corruption, but nothing stops the next hand-authored spec
   from reintroducing a bare key. Every machine authoring site already
   emits `owner: null` (`split.ts:406`, `split.ts:530`,
   `learn/propose.ts:208`, `gather.ts:434`), so there is no emitter to
   fix — the exposed population is hand-authored specs, which means the
   durable control is a **validator**, not a writer change. Add a
   structural check (natural home: `plan/validate-emit.ts`, which
   already owns `spec-missing-branch-frontmatter`) that rejects a bare
   `owner:`/`status:` key and any duplicate frontmatter key.
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

## Links

- Reported by: coordinator session `leonidbelyi-41`, 2026-09-20.
- `debug/debug-9f24c7-2026-08-05T12:20-unparseable-spec-frontmatter-silent.md`
  and `debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md`
  — same class: hand-rolled frontmatter parser vs a degenerate YAML value.
- `dev/dev-f83b04-2026-09-20T09:58-spec-lock-holder-liveness.md` — same
  claim path, unrelated cause.

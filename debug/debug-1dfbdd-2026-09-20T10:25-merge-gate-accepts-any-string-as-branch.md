---
hash: 1dfbdd
type: debug
created: 2026-09-20T10:25:00-06:00
title: "merge-gate accepts any non-null string as a branch name, so an unrecognized sentinel gates as 'no PR yet' forever"
from: null
spawned: []
status: done
owner: /devx-2026-09-20T1806-39763
branch: null
---

## Goal

`merge-gate` decides whether a spec's `branch:` frontmatter is usable by
asking whether it is **not null**:

```ts
const branch =
  typeof fm.branch === "string" && fm.branch.length > 0
    ? fm.branch
    : deriveBranch(merged, resolved.type, hash);   // merge-gate.ts:374-377
```

Any non-null string passes and is handed straight to `gh pr list --head
<branch>`. An empty result becomes `{"merge":false,"reason":"no PR
yet"}` (`merge-gate.ts:420`) — exit 2, permanently.

### Measured in the wild

palateful's `lgort1` carries `branch: unassigned`. Nothing is
mismatched: `gh pr view 27 --json headRefName` → `feat/debug-lgort1`,
`git branch -a --list '*lgort1*'` → the branch exists locally and on
origin, and `branch_prefix: feat/` means `deriveBranch(config, "debug",
"lgort1")` produces exactly that name. The gate simply never asked. It
read the literal string `unassigned`, queried `gh pr list --head
unassigned`, got `[]`, and reported "no PR yet" with a green PR open on
the correct branch.

Blast radius in palateful: 2 specs with `branch: unassigned`, 1 with
`owner: unassigned`. The defect is in the **reader**, not the specs.

### Why `debug-7b3e2a`'s fix does not cover this

This is `7b3e2a` one sentinel later, and the module built to prevent it
says so in its own header (`src/lib/frontmatter-scalar.ts:6-9`):
merge-gate "accepted the 4-character string `null` as a branch name and
queried `gh pr list --head null`, gating every unset-branch spec as 'no
PR yet' forever even with a green PR open on the derived branch."
Character-for-character what is happening to `lgort1`.

`NULLISH_SCALARS` (`frontmatter-scalar.ts:22-28`) enumerates `""`,
`null`, `Null`, `NULL`, `~`. **That enumeration is correct and must not
be extended.** It is YAML's null rule, deliberately faithful, and
`unassigned` genuinely is not null — it is a perfectly ordinary YAML
string. Adding `unassigned` to the set would break YAML fidelity and
merely move the goalpost to the next sentinel.

The real defect is that the guard validates the **wrong predicate**. It
asks *is this value null?* when the question it needs answered is *is
this value a branch that exists?* No amount of null-spelling enumeration
can answer the second, because the failing value is not null.

`unassigned` appears nowhere in devx's `src/`, `_devx/` or `.claude/` —
so it is a convention some downstream authoring path emits that devx's
readers have never been told about. That makes it a write/read contract
gap, and it is exactly why the reader must validate rather than
enumerate: devx cannot enumerate sentinels it has never seen.

## Acceptance criteria

1. `merge-gate` verifies the branch **exists** before querying for a PR
   — `git rev-parse --verify` / `git ls-remote --heads`, or equivalent —
   rather than trusting any non-null string.
2. A `branch:` value that is non-null but names no existing branch
   produces a distinct, actionable verdict naming the value and the
   check that failed. It must NOT be reported as "no PR yet". Suggested:
   exit 2 with `reason: "spec branch 'unassigned' does not exist (from
   frontmatter); derived branch would be 'feat/debug-lgort1'"`.
3. **Three states, three answers — and this AC is unconditional.**
   `gh pr list --head X` returning `[]` currently means any of: X is
   wrong, no PR exists, or X is an unrecognized sentinel. The gate must
   distinguish them. The floor is that the reason string carries the
   branch actually queried: `no PR yet (queried --head 'unassigned')`.
   That is one line, it degrades gracefully if AC 1 never ships, and it
   would have ended this investigation at first contact instead of
   costing a cross-session hunt and two wrong hypotheses. Ship it even
   if everything else here slips.
4. `NULLISH_SCALARS` is **unchanged**. A test pins that `unassigned`
   is NOT nullish, with a comment explaining that extending the set is
   the wrong fix, so a future reader does not "fix" this by enumerating.
5. The same wrong-predicate guard is audited across the other readers of
   `branch:` — `verify-claim.ts:223`, `split.ts:905`,
   `doctor/detect.ts:712` — and any that hand an unvalidated value to a
   command are fixed or documented.
6. Consider a `devx doctor` finding for a spec whose `branch:` is
   non-null and names no existing branch; it is the same predicate as
   AC 1 and catches the class at rest rather than at merge time.
7. Full suite green; `npm run typecheck` clean.

## Technical notes

### Do NOT fix this by making `claim` write `branch:`

The sentinel survives a successful claim — `lgort1` was claimed
(`chore: claim lgort1 for /devx`, palateful `13b4ecb1`) and its
`branch:` still reads `unassigned`, because `claimSpec` writes status,
owner and the status-log line and never touches `branch:`
(`updateSpecForClaim`, `claim.ts:469-507`). That looks like a partial
write worth closing, and it is not.

`branch: null` is a **supported, working state**, and devx relies on it.
Verified in this repo: `debug-135dc9` is `status: in-progress` right now
with `branch: null`, and merge-gate's `deriveBranch` fallback resolves
it correctly. Specs that do carry a branch (`dev-uwg102`,
`dev-dlr105`) got it from the `/devx-plan` emit path, which is the
authored-branch contract `merge-gate.ts:366-370` documents.

So there are two legitimate states — authored branch, or null and
derived — and adding a write-back to `claim` would mask the sentinel
rather than fix the reader, while changing behavior for every spec in
every repo. The reader fix (ACs 1-3) is the correct and sufficient one.

### The write side is still real — and it is now a SHARED control

⚠️ **`debug-828385` AC 7b carries the rule that closes this story's data
half.** It requires `owner:` and `branch:` to be YAML `null` or a valid
value of their type — never bare, never an unrecognized sentinel — which
catches `unassigned` here and the bare `owner:` there with one check.
Narrowing it, re-keying it to different fields, or relaxing which values
count as valid weakens BOTH stories. Check 828385 before changing it,
and say so in the PR body.

That control does **not** replace this story's ACs 1-3. The reader must
still stop trusting any non-null string as a branch name: 7b governs
what devx itself writes and validates, and a sentinel can always arrive
from a repo or an author devx does not control.



`unassigned` reaching a spec at all is a write/read contract gap: an
authoring path emitted a value devx's readers were never told about.
The durable control is `debug-828385` AC 7's validator, generalized
one step — reject any frontmatter value that is neither null nor valid
for its key, rather than only rejecting bare and duplicate keys. That
is the same "validate, don't enumerate" rule arriving from the value
side instead of the key side.

### `cldb01` is a live landmine, not a historical artifact

palateful's `cldb01` carries **both** sentinels (`owner: unassigned`,
`branch: unassigned`) and is `status: ready`, unclaimed. Whoever claims
it next reproduces `lgort1`'s gate failure exactly. Its `owner:` is not
bare (there is a space after the colon), so `debug-828385`'s splice does
not apply — it will be replaced cleanly, and the exposure is the branch
field alone, which claim leaves untouched by design. Worth a heads-up in
that repo ahead of the devx-side fix; it is repo state, not a devx
defect, and does not belong in these ACs.

Deliberately filed separately from `debug-7d96be` (claim/merge-gate type
conventions). Same command, different cause, different fix — 7d96be is
about which spec dir a hash resolves in; this is about validating a
value after resolution succeeds. `7d96be`'s §"Related but separate"
section anticipated this defect but recorded the wrong hypothesis for
it (a branch-name mismatch); its status log now carries the correction.

### Files

- `src/commands/merge-gate.ts:374-377` — the guard; `:420` — the
  "no PR yet" emit.
- `src/lib/frontmatter-scalar.ts:22-28` — `NULLISH_SCALARS`, correct
  as-is (AC 4).
- `src/lib/devx/verify-claim.ts:223`, `src/lib/devx/split.ts:905`,
  `src/lib/doctor/detect.ts:712` — sibling `branch:` readers (AC 5).

## Status log

- 2026-09-20T10:30-06:00 — provenance traced by the coordinator
  session: only two palateful specs carry `branch: unassigned`
  (`lgort1`, `cldb01`), both filed 2026-07-27 by the same parent
  (`btri01`), so the sentinel is one authoring path's "not yet set".
  `lgort1` proves the value survives a claim. Checked here whether that
  means `claim` should write `branch:` back — **it should not**:
  `branch: null` is a working state (`debug-135dc9` is in-progress with
  it today and derives correctly), so a write-back would mask the
  sentinel instead of fixing the reader. Recorded as a Technical note so
  the next reader does not reach for it. AC 3 made unconditional at the
  reporting session's request.
- 2026-09-20T10:25-06:00 — filed. Root cause measured by the
  coordinator session in palateful against `lgort1` (branch exists, PR
  #27 open on it, `branch: unassigned` in frontmatter); mechanism
  verified here in devx source at `2f132eb`. Supersedes the
  branch-mismatch hypothesis recorded in `debug-7d96be`, which was
  wrong. Confirmed `unassigned` appears nowhere in devx's own tree.
- 2026-09-20T18:06:29-06:00 — claimed by /devx in session /devx-2026-09-20T1806-39763
- 2026-09-21T12:36:36-06:00 — merged via PR #163 (squash → c0de19f)

## Links

- `debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md`
  — the same failure with `null` as the sentinel; its fix is present and
  correct, and does not cover this.
- `debug/debug-7d96be-2026-09-20T10:21-claim-type-resolution-inconsistent.md`
  — same command, different cause.
- `plan/plan-4c827d-2026-09-20T10:11-detector-discrimination.md` — the
  three-states-one-answer specimen.
- `debug/debug-828385-…-claim-splices-duplicate-owner-key.md` AC 7 —
  the same enumeration-versus-validation trap on frontmatter keys.
- 2026-09-20T18:30-06:00 — implemented. ACs 1-5 and 7 met; **AC 6 deliberately NOT implemented — see the argument below, which I think is a correction to the spec.**
  - **AC 1/2 shape changed on devx-b6's advice, and the change matters.** My first cut validated the branch as a *precondition*, before the PR query. b6 caught the regression: the query is `--state all`, which matches merged and closed PRs, and the documented flow squash-merges with `--delete-branch` — so a spec that completed successfully has a real merged PR and NO remote ref. A precondition would suppress the lookup and accuse exactly those specs of naming a dead branch: the loud-and-wrong failure, in place of the quiet-and-wrong one. Final shape is query-first, with existence used only to *explain* an empty result. Pinned by a test (`cc0003`) that fails if anyone reintroduces the precondition.
  - **Could-not-verify is not absence.** `explainEmptyPrList` returns `string | null`, and the null routes to the existing `safeFailureExit`. A failed `ls-remote` — offline, no `origin`, auth failure — must never produce a "does not exist" verdict, or the fix builds a *fourth* indistinguishable state into the command whose defect is three states sharing one answer. Mutation-verified: collapsing the null into a boolean fails exactly that one test.
  - **AC 3** ships in every empty-result path: `no PR yet (queried --head 'X')`. Independent of AC 1 as required.
  - **AC 4**: `NULLISH_SCALARS` untouched. Test pins the set at exactly YAML's five spellings and asserts nine plausible sentinels (`unassigned`, `tbd`, `TODO`, `none`, `nil`, …) are strings, with a comment explaining why extending the set is wrong twice over — factually about YAML, and ineffective against the next sentinel.
  - **AC 5 widened, and found live bugs.** `split.ts:907` (`v === "" || v === "null"`) and `detect.ts:714` (`"" | "null" | "~"`) were both narrower than `isNullishScalar` — `Null` and `NULL` were being read as branch NAMES. That is debug-7b3e2a's original defect still live in two readers, seven weeks after merge-gate was fixed. Both folded onto the shared rule. `detect.ts`'s consequence is concrete: doctor carried `"NULL"` into a finding and `applyFixes` would have run `git branch -D NULL`. Both mutation-verified; `detect.ts`'s fix was initially unguarded (all 60 doctor tests passed with the bug reintroduced) until a test was added that pins the `git branch -D` observable.
  - **AC 7**: `tsc --noEmit` clean. Full suite: 4188 passed, 10 failed — all 10 pre-existing and none in the touched surface. Verified against a baseline worktree at the unmodified claim commit: `loop-worker` (8) and `manage-spawn` (1) pass in isolation and fail only under full-suite parallel load (child-process timing); `workstream-migration-integrity` fails identically at baseline and on main.
  - **Pre-existing red on devx main, unrelated and worth someone's attention:** `workstream-migration-integrity` asserts `slugs.length >= 9`, but `_devx/workstreams/` holds exactly one directory (`usage-window-governor`); the rest were archived (`837072b archive: blocker-push-interim (retired)`). The floor is stale. Not filed here — it is not this spec's surface — but it is the same family as everything else in this story: an assertion pinned to a number reality moved past.

### AC 6 — declined, with reasons (the spec's premise does not hold)

AC 6 says a doctor finding is "the same predicate as AC 1". **It is not**, and the reason is the one b6 used to correct my precondition design.

AC 1 fires at a narrow, high-signal moment: a spec whose PR query *just came back empty*. Absence of a branch there is genuinely surprising. A doctor finding would evaluate the same predicate on every spec **at rest**, where a missing branch is the normal state in at least three ways:

- `ready` specs authored by `/devx-plan` carry a branch that does not exist yet, because the work has not started.
- `done` specs squash-merged with `--delete-branch` have no branch by design — the exact case that killed the precondition.
- attach-mode follow-ups (mss102) sit on branches no derivation produces, which `detect.ts` already comments on.

So the detector's true-positive case is one sentinel among three routinely-absent-and-fine populations. It would fire mostly on healthy specs.

That is not merely low value, it is **negative** value right now, and this story is the reason I am confident about it: `f83b04` currently reports every live claim as a dead owner, four sessions have been told today to ignore dead-owner findings, and the habit outlives the code fix. Adding a second noisy finding class to a detector people are actively being trained to ignore damages the detector for the cases it already gets right.

If the class is still wanted, the version worth building is narrower and does not need git: **flag a `branch:` value that is not a valid git ref name at all** (`git check-ref-format --branch`). `unassigned` passes that, so it would not have caught lgort1 — which is itself the finding: the durable control for a sentinel reaching a spec is the write-side validator (`debug-828385` AC 7), not a read-side detector. The spec's own Technical notes say this. AC 6 is the same enumeration reflex arriving from the detector side.

Recommend AC 6 be struck or re-filed against the validator. Flagged to devx-b6 rather than decided unilaterally.

### The guard found a third offender, in the worst possible place

Writing the single-source guard (`test/nullish-rule-single-source.test.ts`)
turned up a reader neither the spec nor my own AC 5 audit had named:
`detect.ts:110 ownerOf()` — `raw === "" || raw === "null" || raw === "~"`.

It is the narrowest copy in the highest-stakes spot. `owner:` is what the
**dead-owner detector** reads, so `owner: NULL` resolved to the literal owner
`"NULL"` — a spec with no owner looked owned, and was therefore never
reported. It also stripped quotes *before* testing nullish, which is the
mirror-image bug `frontmatter-scalar.ts` documents in its own header: a
quoted `"null"` is a real string per YAML, and collapsing it there loses the
distinction the module was built to keep. Fixed both ways round.

That makes **three** hand-rolled copies alive seven weeks after `7b3e2a`
closed, not the two the spec names. I found two by reading the files the spec
listed; the third only turned up when I wrote a check that reads the whole
tree. That is the argument for the guard existing at all: an audit finds what
it was pointed at, and this class is defined by turning up where nobody
pointed.

The guard deliberately does **not** flag a bare `~`. In this tree `~` is far
more often a home-directory prefix (`learn/config.ts:131`,
`learn/route.ts:101`) than a YAML null, and a guard that cries wolf on path
handling is a guard someone deletes — the same habituation argument that
sank AC 6. Every real offender compares against `"null"`, so that is the
discriminating token. A hypothetical rule testing only `~` would slip
through; that is an accepted trade for a guard that stays credible.

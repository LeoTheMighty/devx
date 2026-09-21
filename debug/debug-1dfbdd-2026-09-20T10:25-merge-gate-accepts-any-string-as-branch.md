---
hash: 1dfbdd
type: debug
created: 2026-09-20T10:25:00-06:00
title: "merge-gate accepts any non-null string as a branch name, so an unrecognized sentinel gates as 'no PR yet' forever"
from: null
spawned: []
status: in-progress
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

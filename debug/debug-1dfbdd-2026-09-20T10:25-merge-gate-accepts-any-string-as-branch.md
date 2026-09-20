---
hash: 1dfbdd
type: debug
created: 2026-09-20T10:25:00-06:00
title: "merge-gate accepts any non-null string as a branch name, so an unrecognized sentinel gates as 'no PR yet' forever"
from: null
spawned: []
status: ready
owner: null
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
3. **Three states, three answers.** `gh pr list --head X` returning `[]`
   currently means any of: X is wrong, no PR exists, or X is an
   unrecognized sentinel. The gate must distinguish them. At minimum the
   reason string carries the branch actually queried — one line that
   turns an undiagnosable answer into a diagnosable one.
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

The cheap half of this (AC 3) is worth doing even if AC 1 is deferred:
carrying the queried branch in the reason string costs one line and
would have made `lgort1` self-diagnosing on first contact instead of
requiring a cross-session investigation.

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

- 2026-09-20T10:25-06:00 — filed. Root cause measured by the
  coordinator session in palateful against `lgort1` (branch exists, PR
  #27 open on it, `branch: unassigned` in frontmatter); mechanism
  verified here in devx source at `2f132eb`. Supersedes the
  branch-mismatch hypothesis recorded in `debug-7d96be`, which was
  wrong. Confirmed `unassigned` appears nowhere in devx's own tree.

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

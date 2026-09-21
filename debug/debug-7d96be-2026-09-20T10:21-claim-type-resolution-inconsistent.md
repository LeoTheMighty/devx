---
hash: 7d96be
type: debug
created: 2026-09-20T10:21:00-06:00
title: "claim requires --type while merge-gate auto-resolves: two type conventions in one loop"
from: null
spawned: []
status: done
owner: /devx-2026-09-21T1024-41522
branch: null
---

## Goal

Two commands in the same `/devx` loop resolve a spec hash by opposite
conventions, and only one of them is documented.

- `devx devx-helper claim <hash>` defaults to `dev` (`claim.ts:520`,
  `claim.ts:566`) and fails at stage `resolve` with *"no spec file found
  at dev/dev-<hash>-*.md"* unless the caller passes `--type debug`.
- `devx merge-gate <hash>` takes **no** `--type` flag and does not need
  one: it calls `findSpecForHashAnyType` (`merge-gate.ts:334`) and
  derives the branch from the resolved type (`deriveBranch(merged,
  resolved.type, hash)`, `merge-gate.ts:376`). That was
  `debug-6a913f`'s fix — the gate deliberately serves every backlog
  type.

So the loop has a first-class type-resolving primitive and a
dev-defaulting one, and a reader has no way to know which is which. The
skill body documents `--type debug` for `finalize` only
(`.claude/commands/devx.md:503`, :519); the `claim` invocation at :159
and its exit-code table at :161-167 never mention it. A debug item run
through `/devx` as written fails on its first command.

Reported by the coordinator session from palateful-2d.

## Acceptance criteria

- [x] AC 1: `devx devx-helper claim <hash>` resolves a spec of **any** type
   without a flag, using `findSpecForHashAnyType` exactly as
   `merge-gate.ts:334` does — one resolution convention across the loop,
   not two. `--type` stays accepted as an explicit override/disambiguator.
- [x] AC 2: `AmbiguousSpecHashError` (the same hash under two spec dirs) is
   surfaced by `claim` as a typed refusal naming both paths, matching
   merge-gate's handling at :336-338. It must not silently pick one.
- [x] AC 3: Every other hash-consuming command is audited for which convention it
   uses, and the answer is recorded. Known consumers: `verify-claim`
   (`devx-helper.ts:476`, takes `--type`), `finalize`
   (`devx-helper.ts:725`, takes `--type`), `release-lock`, `split`,
   `doctor` (`detect.ts:134` iterates `SPEC_TYPE_DIRS` — already
   type-aware). Converging them is in scope; leaving one deliberately
   different requires a comment saying why.
- [x] AC 4: `.claude/commands/devx.md` states the resolution rule once, where the
   claim happens, rather than leaving `--type` discoverable only from
   the `finalize` section.
- [x] AC 5: Regression test: a `debug/` spec claims, verifies, and finalizes
   through the documented commands with no type flag anywhere.
- [x] AC 6: Full suite green; `npm run typecheck` clean. (Local: parallel 141/141 files / 3368 tests, serial 39/39 / 890, `REAL_EXIT=0` read from the variable; typecheck exit 0.)

## Technical notes

### What this is NOT

The report framed this as "`merge-gate` has no `--type` flag, so the
debug arm of the loop cannot reach Phase 8 — a dead end in the state
machine." **That diagnosis is wrong and the ACs deliberately do not
encode it.** merge-gate is fully type-aware; the missing flag is by
design.

The observed `{"merge":false,"reason":"no PR yet"}` on palateful's
`lgort1` (PR #27 open and MERGEABLE) therefore has a different cause,
and it is a **branch-resolution mismatch**, not a type gap. Verified in
source: a resolution miss returns a *different* string (`no spec file
for hash '<h>' under any spec dir (…)`, `merge-gate.ts:345`), so the
spec resolved fine. The gate then takes:

```ts
const branch = typeof fm.branch === "string" && fm.branch.length > 0
  ? fm.branch
  : deriveBranch(merged, resolved.type, hash);
```

and queries `gh pr list --head <branch>`. An empty result is reported as
"no PR yet". So the branch it asked about is not PR #27's head branch.
`debug-7b3e2a`'s null-as-string defect is **not** the cause — that fix
is present (`merge-gate.ts:128-131`, "Nullish scalars come back
`undefined`, never a string").

Diagnostic for whoever picks this up, to be run in the affected repo:

```
gh pr view 27 --json headRefName        # what the PR actually uses
grep '^branch:' debug/debug-lgort1-*.md # what the spec claims
# and compare against deriveBranch(config, "debug", "lgort1")
```

**RESOLVED 2026-09-20, and the hypothesis above was wrong.** It is not
repo state and not a branch mismatch: the branch exists, matches
`deriveBranch` exactly, and is PR #27's `headRefName`. `lgort1` carries
`branch: unassigned`, and merge-gate's guard accepts any non-null string
as a branch name — so it queried `gh pr list --head unassigned`. Filed
as `debug-1dfbdd`; it is a devx reader defect, not repo state. The ACs
in this story are unaffected.

### Related but separate: the gate's uninformative answer

Independent of the branch mismatch, `gh pr list --head X` returning `[]`
is reported as "no PR yet" whether X is wrong or the PR genuinely does
not exist. Those are different facts and the gate cannot distinguish
them. That is a specimen for `plan-4c827d` (detector discrimination),
not an AC here — but if the fix is cheap, making the reason string carry
the branch it queried turns an undiagnosable answer into a diagnosable
one for roughly one line.

### `devx tour` — the report's third item is inverted

palateful-2d observed `unknown command 'tour'` and attributed it to a
stale PATH build. **It is the opposite.** `devx tour` was retired at
tur101 on 2026-08-04: `src/lib/tour/` does not exist, `src/cli.ts` has
no `tour` command, and `.claude/commands/devx.md` has no Phase 7.5.
"unknown command" is a **current** build behaving correctly; the stale
artifact is palateful's *skill body*, which still invokes a command
devx deleted six weeks ago.

devx does print a real stale-build warning (`cli.ts:57`,
`isBuildStale`/`staleBuildWarning`), which is presumably what 2d saw —
genuine, but unrelated to `tour`. Fixing this means updating palateful's
installed skills, not rebuilding the CLI. No AC here; it is a
downstream-repo action, and the general "packaged skills drift from the
CLI" problem is `dev-pin101`'s territory.

### Files

- `src/lib/devx/claim.ts:520`, `:566` — the `"dev"` defaults.
- `src/commands/devx-helper.ts:188`, `:476`, `:725` — the three `--type`
  parsers.
- `src/commands/merge-gate.ts:334`, `:376` — the convention to converge on.
- `src/lib/engine/frontmatter.ts:574` — `findSpecForHashAnyType`.
- `.claude/commands/devx.md:159-167` — the undocumented claim call.

## Resolution (2026-09-21)

### What changed

One resolution rule for every hash-taking step of the loop. A new
`lookupSpecForHash(fs, repoRoot, hash, explicitType?)` in `claim.ts` wraps
the shared `findSpecForHashAnyType` — the function `merge-gate` already used —
and `claim`, `verify-claim`, `mark-done`, `split` and `finalize` all resolve
through it. With no `--type`, the spec is found under whichever dir holds it;
`--type` survives as an override and disambiguator.

The shared primitive gained an optional `SpecDirReader` rather than claim
getting a third copy. That matters here specifically: claim's family of
commands runs against an injected `ClaimFs` in tests, so calling the real-fs
resolver would have bypassed every fake. `ClaimFs` satisfies the reader
interface structurally, so the same function now serves both.

### Two private copies removed

- `claim.ts findSpecForHash` was a hand-kept duplicate of the shared
  resolver, commented "Mirrors merge-gate.ts's resolver — same shape, same
  boundary." It no longer did: the shared one sorts its `readdir`, the copy
  did not. It now delegates. **A private mirror with a comment asserting it
  is a mirror is exactly how the `dev` default survived in one half of the
  loop** — nobody re-checks a comment.
- `mark-done.ts` carried its own copy of `isClaimableType`; it now imports
  the one from `claim.ts`.

### AC 3 audit — every hash-consuming command

| command | before | after |
|---|---|---|
| `merge-gate` | resolves any type (debug-6a913f) | unchanged — the convention converged on |
| `devx split` (CLI) | resolves any type from the hash | unchanged — already converged |
| `claim` | defaulted to `dev` (`claim.ts:565`) | resolves |
| `verify-claim` | defaulted to `dev` (`verify-claim.ts:303`) | resolves |
| `mark-done` | defaulted to `dev` (`mark-done.ts:360`) | resolves |
| `split` (library) | defaulted to `dev` (`split.ts:792`) | resolves |
| `finalize` | defaulted to `dev` at the CLI (`devx-helper.ts:957`) | resolves; exit 2 at stage `resolve` on a miss |
| `release-lock` | no type — lock is keyed by hash alone | unchanged; type-independent by construction |
| `doctor` | iterates `SPEC_TYPE_DIRS` (`detect.ts:134`) | unchanged — already type-aware |

The spec listed four consumers plus release-lock and doctor. The audit found
**five** that defaulted, not four: `split`'s *library* defaulted to `dev` even
though `split`'s own *CLI* already resolved the type — so the CLI worked and
any direct caller of the library did not. Same command, both conventions.

### Behaviour kept deliberately

- **Guard ordering in `claim` is unchanged.** The lookup stays where it was,
  after the canonical-root and branch-posture guards; only the type-dependent
  values (backlog file, derived branch) moved after it. Resolving earlier
  would have let a missing spec pre-empt a linked-worktree refusal.
- **An explicit `--type` is still validated up front**, so a bad flag costs
  nothing, and an explicit type that names the wrong dir fails with the
  pre-7d96be message byte-for-byte.
- A hash resolving to an unclaimable type (e.g. `plan`) is refused at
  `validate`, naming the type and path.

### AC 4 — skill body

`.claude/commands/devx.md` now states the rule once, at the claim step: the
hash alone identifies the spec at every step, `--type` is only an
override/disambiguator. `[--type debug]` is gone from the Phase 8 `finalize`
invocation. Also fixed a hardcoded `.worktrees/dev-<hash>` in the worktree
recovery instruction, which was wrong for debug items. `skills/devx.md`
regenerated via `npm run sync:skills`. `--help` strings no longer claim
`'dev' (default)`.

### Prose budget — tripped, then trimmed

The first full-suite run failed `engine-prose-budget.test.ts` (S-1 canary):
the skill-body surface came to 123,225 bytes against a 122,880 tripwire.
`main` had only **170 bytes** of headroom, and my first draft of the AC 4
sentence added 515. Trimmed the rule to one sentence and dropped an
explanatory parenthetical; net growth is now +142 and the canary passes.
The budget was deliberately **not** raised — re-recording it is a retro
decision, not a side effect of a bug fix.

Consequence worth knowing: `main` now has **28 bytes** of headroom on that
surface. The next skill-body edit by anyone will trip the canary, and the
person who hits it will not be the person who spent the margin.

### Tests

Nine new cases plus one inverted:

- `verify-claim`: the test **"default type ('dev') does NOT resolve a debug
  spec"** pinned the bug as expected behaviour. Inverted to "no type resolves a
  debug spec", and its diagnostic value kept by moving the "does not resolve"
  assertion onto an explicit `type: "dev"`, where override semantics must
  still hold.
- `claim`: no-type debug claim (AC 1); ambiguous hash refused naming both
  paths with nothing mutated, and `--type` disambiguating (AC 2); plan-spec
  hash refused as unclaimable; a miss names every dir searched rather than
  `dev/`.
- `mark-done`, `split` (library): debug item with no type.
- `finalize` CLI: debug item with no `--type` finalizes, and the resolved
  type reaches the worktree stage (`feat/debug-…`, never `feat/dev-…`); an
  unresolvable hash exits 2 at `resolve` with zero exec calls and nothing
  written (AC 5).

**Mutation-verified:** reinstating `explicitType ?? "dev"` inside
`lookupSpecForHash` fails all nine new cases and nothing else; the explicit
override test correctly stays green.

### Not done here

- `plan-4c827d`'s "`no PR yet` is uninformative" note — out of scope, and
  `debug-1dfbdd` owns merge-gate's branch handling.
- palateful's stale skill body still invoking `devx tour` — downstream repo
  action, `dev-pin101`'s territory, as the spec already records.

## Status log

- 2026-09-20T10:25-06:00 — the branch-mismatch hypothesis recorded
  below is **superseded**: the real cause is `branch: unassigned` and a
  merge-gate guard that accepts any non-null string as a branch name
  (`debug-1dfbdd`). The refutation of the dead-end framing stands — the
  gate is type-aware, and the failure had nothing to do with type.
- 2026-09-20T10:21-06:00 — filed. All three reported items checked in
  source at `9dc2366`. Item 1 (claim needs `--type`) **confirmed**, and
  widened: the real defect is two resolution conventions in one loop,
  not a missing doc line. Item 2 (merge-gate dead end) **refuted** —
  merge-gate is type-aware via `findSpecForHashAnyType` per
  `debug-6a913f`; the `lgort1` symptom is a branch-resolution mismatch,
  and the diagnostic is recorded above rather than guessed at. Item 3
  (`devx tour`) **inverted** — tour was retired at tur101, so the CLI is
  current and the skill body is stale.
- 2026-09-21T10:24:00-06:00 — claimed by /devx in session /devx-2026-09-21T1024-41522
- 2026-09-21T10:48:44-06:00 — merged via PR #167 (squash → 8e05e05)

## Links

- Reported by: coordinator session `leonidbelyi-41` (from palateful-2d),
  2026-09-20.
- `debug/debug-6a913f-2026-07-15T08:27-tour-gather-no-debug-spec-support.md`
  — made merge-gate type-aware; this story finishes the job on `claim`.
- `debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md`
  — the other way `--head` goes wrong; fix confirmed present, not the cause here.
- `dev/dev-tur101-2026-08-04T10:00-retire-review-tour.md` — why `tour` is gone.
- `plan/plan-4c827d-2026-09-20T10:11-detector-discrimination.md` — the
  "no PR yet" answer as a discrimination specimen.
- 2026-09-21T11:30 — fixed on `feat/debug-7d96be`. Converged five
  consumers (not four: `split`'s library defaulted while its CLI did not) onto
  one lookup through the shared resolver; removed two private copies. Bug
  reproduced first on the current post-828385 binary (exit 2 at `resolve`,
  nothing written). Nine new tests plus one inverted test that had pinned the
  bug, all mutation-verified.

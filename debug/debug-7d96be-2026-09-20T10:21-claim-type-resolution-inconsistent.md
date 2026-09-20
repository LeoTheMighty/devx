---
hash: 7d96be
type: debug
created: 2026-09-20T10:21:00-06:00
title: "claim requires --type while merge-gate auto-resolves: two type conventions in one loop"
from: null
spawned: []
status: ready
owner: null
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

1. `devx devx-helper claim <hash>` resolves a spec of **any** type
   without a flag, using `findSpecForHashAnyType` exactly as
   `merge-gate.ts:334` does — one resolution convention across the loop,
   not two. `--type` stays accepted as an explicit override/disambiguator.
2. `AmbiguousSpecHashError` (the same hash under two spec dirs) is
   surfaced by `claim` as a typed refusal naming both paths, matching
   merge-gate's handling at :336-338. It must not silently pick one.
3. Every other hash-consuming command is audited for which convention it
   uses, and the answer is recorded. Known consumers: `verify-claim`
   (`devx-helper.ts:476`, takes `--type`), `finalize`
   (`devx-helper.ts:725`, takes `--type`), `release-lock`, `split`,
   `doctor` (`detect.ts:134` iterates `SPEC_TYPE_DIRS` — already
   type-aware). Converging them is in scope; leaving one deliberately
   different requires a comment saying why.
4. `.claude/commands/devx.md` states the resolution rule once, where the
   claim happens, rather than leaving `--type` discoverable only from
   the `finalize` section.
5. Regression test: a `debug/` spec claims, verifies, and finalizes
   through the documented commands with no type flag anywhere.
6. Full suite green; `npm run typecheck` clean.

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

The likely shapes are a hand-created branch that does not match
`deriveBranch`'s output, or a `branch:` frontmatter value written by a
claim that ran under the wrong type. Either way the fix belongs here
only if it turns out to be a devx defect rather than repo state — file
separately if it is repo state.

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

## Status log

- 2026-09-20T10:21-06:00 — filed. All three reported items checked in
  source at `9dc2366`. Item 1 (claim needs `--type`) **confirmed**, and
  widened: the real defect is two resolution conventions in one loop,
  not a missing doc line. Item 2 (merge-gate dead end) **refuted** —
  merge-gate is type-aware via `findSpecForHashAnyType` per
  `debug-6a913f`; the `lgort1` symptom is a branch-resolution mismatch,
  and the diagnostic is recorded above rather than guessed at. Item 3
  (`devx tour`) **inverted** — tour was retired at tur101, so the CLI is
  current and the skill body is stale.

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

---
hash: 7b3e2a
type: debug
created: 2026-08-07T12:40:00-06:00
title: merge-gate reads YAML `branch: null` as the string "null" and queries a branch by that name, so every unset-branch spec gates as "no PR yet"
from: debug/debug-4d1a9c-2026-08-07T11:37-claim-commits-on-current-branch-not-base.md
plan: null
spawned: []
status: in-progress
owner: /devx-loop-2026-08-19T19-39-20-483-20983
branch: null
---

## Goal

`devx merge-gate <hash>` should find a spec's PR whenever one exists. When the
spec's frontmatter carries no branch, it should fall back to `deriveBranch`.

Today a spec whose frontmatter reads `branch: null` — the explicit-unset shape
that hand-authored specs and `/devx`'s own claim path both produce — never
reaches the fallback. It gates as `{"merge":false,"reason":"no PR yet"}` with
exit 2 forever, even with a green CI'd PR open on the derived branch.

## Reproduction

Observed 2026-08-07 while merging `4d1a9c` against `devx` @ `455f02c`.

```
$ grep '^branch:' debug/debug-4d1a9c-….md
branch: null

$ gh pr list --head feat/debug-4d1a9c --state all --json number,state --limit 1
[{"number":123,"state":"OPEN"}]        ← the PR is right there

$ devx merge-gate 4d1a9c
{"merge":false,"reason":"no PR yet"}
EXIT=2

$ gh pr list --head null --state all --json number,state --limit 1
[]                                     ← what the gate actually asked for
```

Flipping only that one field fixes it, with nothing else changed:

```
$ sed -i '' 's|^branch: null$|branch: feat/debug-4d1a9c|' debug/debug-4d1a9c-….md
$ devx merge-gate 4d1a9c
{"merge":true}
EXIT=0
```

## Root cause

`readFrontmatter` (`src/commands/merge-gate.ts:111`) hand-rolls a scalar parse
and assigns the raw text: for `branch: null` it stores the four-character
**string** `"null"`, not a null. The branch fallback then reads

```ts
const branch =
  typeof fm.branch === "string" && fm.branch.length > 0
    ? fm.branch                                   // ← "null" passes both tests
    : deriveBranch(merged, resolved.type, hash);
```

`"null"` is a string of length 4, so the guard accepts it and `deriveBranch` is
never called. The gate then queries `gh pr list --head null`, gets `[]`, and
returns the exit-2 "no PR yet" branch (`merge-gate.ts:376`).

Same defect class as `debug-9f24c7` (frontmatter that reads as something other
than what it says) — a hand-rolled parser disagreeing with YAML about what
`null` means.

## Impact

- Attended: every merge of a spec that never had `branch:` set stops at Phase 8
  with a reason that points at the PR ("no PR yet") rather than at the spec, so
  the operator goes looking on GitHub for a PR that is plainly already there.
- Unattended: the loop's merge tail strands a green, CI-passing item unmerged —
  the same failure shape `debug-d7e8e5` describes for transient gh 401s, but
  permanent and fully deterministic for the affected specs.
- Likely under-noticed because `/devx-plan`-emitted specs record their derived
  branch at creation, so only hand-authored or claim-path specs carry `null`.

## Acceptance criteria

- [ ] `branch: null` (and `~`, and an empty value) fall through to
      `deriveBranch` rather than being used as a branch name.
- [ ] The same treatment for `status:` and any other scalar `readFrontmatter`
      returns — `status: null` must not compare equal to the string `"null"`.
- [ ] A spec with `branch: null` and an open PR on its derived branch gates
      `{"merge":true}` (given CI green and mode allowing).
- [ ] Regression test covering `branch: null`, `branch: ~`, `branch:` (empty),
      and a real branch value, asserting which of them reach `deriveBranch`.
- [ ] Audit the other hand-rolled frontmatter readers for the same
      null-as-string assumption; `parseSpecClaimFields` and `readEngineState`
      are the obvious neighbours. Fold into `debug-9f24c7` if it is the same
      root parser.

## Technical notes

- The narrow fix is a `NULLISH_SCALARS = new Set(["null", "~", ""])` check at
  assignment time in `readFrontmatter`; the broader fix is to stop hand-rolling
  and use the `yaml` dep already in `dependencies` (see `debug-b365ac` — it is
  a runtime dep precisely because `dist/lib/config-io.js` imports it).
- Worth deciding whether `claimSpec` should WRITE the derived branch into the
  spec at claim time. It already rewrites `status:` and `owner:` there, and
  doing so would make the frontmatter self-describing rather than leaving the
  gate to re-derive. That is a design call, not obviously in scope here.

## Status log

- 2026-08-07T12:40 — filed from the `4d1a9c` Phase 8, where it blocked the
  merge of a green CI'd PR. Root-caused to `merge-gate.ts:111` +
  `merge-gate.ts:333` and proven by flipping the single field.
- 2026-08-20T09:13:31-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983

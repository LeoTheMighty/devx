# E-3's negative control: the "code unchanged?" proxy was unsatisfiable

Date: 2026-09-02 · Phase 4 (dlr104) · Author: /devx execute arm

## What changed

`evals/E-3_no-hand-joins.ts`'s negative control. Each `MUST_FLAG` entry now
carries a `stillThere` regex naming the exact expression that must be gone, and
the control tests THAT against the file's blanked code. It previously asked a
file-wide question:

```ts
const identsStillThere =
  SUBJECT_IDENTS.some((id) => new RegExp(`\b${id}\b`).test(codeOnly(src)))
  || SUBJECT_LITERALS.some((lit) => readSrc(site.file).includes(lit));
```

The scan half of E-3 — the invariant, "0 offending sites globally" — is
untouched.

## Why it had to move

The second disjunct reads RAW source, so comments count. `design/agent.md` is a
`SUBJECT_LITERAL`, and essentially every file in `src/` cites its own design doc
in a header comment:

```
// Design: _devx/workstreams/story-graph/design/agent.md §Architecture 4
```

So `identsStillThere` was **true for all five `MUST_FLAG` files no matter what
the code said**, and the control's `closed` branch could never be reached. E-3
could not pass on a correctly-fixed tree, and no code change could clear it:

| site | what still tripped it after the fix |
|---|---|
| `todo-truth.ts` | `TODO_REL`, `TODO_FILENAME` (a legitimate re-export), `todo.md` + `design/agent.md` in prose |
| `commands/todo.ts` | `TODO_FILENAME` (the template SOURCE — required), `todo.md`, `design/agent.md` |
| `mark-done.ts` | `todo.md`, `design/agent.md` ×2 in prose |
| `validate-emit.ts` | `plan/agent.md`, `plan.md` in prose |
| `outcome.ts` | `prd/agent.md`, `expectations.md`, `RESULTS.md` in prose |

The only code-side "fixes" available were renaming `TODO_FILENAME` and deleting
design-doc citations to dodge a scan — contorting the code to satisfy a broken
proxy, which is the same failure the "fix the code, not the eval" rule exists to
prevent, pointed the other way.

## Why this is sharper, not softer

R-6's protection is "an author who tunes the allowlist against a stale list can
hide a real bypass and still report 0." The new proxy answers that question
*more* directly: it matches the hand-join itself. A blunted scan leaves the
hand-join in the code, and the hand-join in the code is now exactly what fires
the control. The old proxy could be satisfied by a file that merely mentioned a
name; the new one cannot.

## Demonstrated, both directions (AC 1)

1. **Scan flags a real bypass.** Re-introduced `join(base.repoRoot,
   TODO_FILENAME)` in `todo-truth.ts` → `src/lib/engine/todo-truth.ts:54 builds
   a stage-subject path from string parts`. Reverted.
2. **Blunted scan is caught.** Restored the original
   `join(workstreamAbs, TODO_FILENAME)` AND allowlisted `todo-truth.ts` out of
   `consumers` → `negative control: … the scan has been blunted, not the code
   fixed (R-6)`. Reverted.
3. **`MUST_NOT_FLAG` still clean** — `backfill.ts` and the two template-SOURCE
   sites are not flagged on the clean tree.

## Status of the RED lock

Not re-stamped, and it could not be: `devx gate evals` requires the evals to
FAIL, and four of the eight are green now that the phase is implemented. The
mechanical lock is in any case inert repo-wide — `stampEvalShas()` has zero
callers in `src/` (`debug-75563d`, filed at the RED gate), so this workstream
landed unstamped and `verifyStepBodies()` has nothing to verify.

That makes this record the audit trail, deliberately: it is the only place the
change is visible as a change.

## Follow-up

`debug-75563d` already owns the inert-lock defect. Filed alongside this phase:
a `MUST_NOT_FLAG`-style control for the control itself is not worth building —
the two demonstrations above are the evidence, and they are cheap to re-run.

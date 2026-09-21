---
hash: evlk01
type: debug
created: 2026-09-21T11:30:00-06:00
title: "RED eval lock only guards files it already recorded — added, re-pointed and stripped evals bypass it"
from: debug/debug-75563d-2026-09-02T09:20-red-eval-sha-lock-unwired.md
spawned: []
status: ready
owner: null
branch: null
---

## Goal

The retroactive adversarial review of devx PR #164 (the change that armed the
RED eval lock) found the lock sound at its core — all 8 mutations that tried
to make stamp or verify vacuous were caught — but **scoped to the files it has
already stamped**. Almost every bypass works by changing *which* files are
stamped rather than editing a stamped one. The fixable subset shipped with the
review; the four items here each change what the lock *means*, so they need a
decision before code. All four were reproduced against `main`.

## Findings needing a decision

### B — `--verify` cannot see an added or re-pointed eval (HIGH)

`--verify` builds its comparison set from the stamped keys
(`src/commands/gate.ts`, the `if (flags.verify)` block), so:

- **Re-pointed:** copy an eval, soften the copy, point the plan's coverage row
  for E-1 at the copy. The stamped original is untouched → `--verify` PASS.
- **Added:** add a new P0 after Gate 4 with an exit-0 test → PASS.

The lock hashes file *contents*; it never locks the E-id → artifact mapping or
`expectations.md`.

### C — an emptied stamp is indistinguishable from "never stamped" (MED)

Grandfathering is inferred from *absence*: no `red_eval_shas` key means "this
workstream predates the lock". So deleting the key (or one entry) from an
agent-editable spec unlocks those evals, and `--verify` PASSes with
`stamped: 0` while `evals_red: true`. There is no marker distinguishing
"grandfathered" from "stamped, then emptied".

**B and C are coupled.** Catching an added or re-pointed eval means rebuilding
the current eval set from the plan and comparing; doing that without breaking
grandfathering requires knowing whether this workstream was ever stamped.

**Recommendation:** record `gate_status.evals_locked: true` at stamp time. In a
locked workstream, an unstamped current eval or a re-pointed artifact
**blocks** `--verify`; unlocked (grandfathered) workstreams stay advisory. This
changes when the lock blocks, which is why it is a decision and not a fix.

### D — no working path to re-stamp after the eval legitimately changes (HIGH, policy)

Re-running Gate 4 cannot re-stamp an eval that now passes: Gate 4 requires P0
evals to be RED, so the re-run FAILs and nothing is re-stamped. Before the
review fix, `--waive` "worked" only by deleting the lock (review finding A,
now fixed — a waiver keeps the original sha).

What shipped with the review: skill prose now names `devx revise` as the path.
It reopens the red stage and — as of the review fix — clears the stamp, so the
evals can be re-authored and re-gated. **That path works today.** The open
question is only whether it is the *right* one.

**Recommendation: keep `devx revise` and add no new mechanism.** "The
expectation genuinely changed" *is* a revision. The alternative — a
`--restamp <E-n> --reason --approver` flag that re-stamps without RED — is a
second waiver mechanism, and `--waive` being usable to drop a lock is how
finding A happened.

### H — markdown evals leave their command and expected result unlocked (MED)

`RESULT_FIELDS` in `src/lib/engine/evals-lock.ts` includes `run` and `result`,
and `RUNS_ROW_RE` matches **every** line starting with `|`. For a markdown
eval, `Run: node bench.mjs --lines 10000` → `--lines 10` and
`Result: p95 under 8s` → `800s` produce an **identical sha** (verified
directly). Exposure is P1+ `.md` evals — a P0 `.md` eval FAILs Gate 4.

This is an eval-authoring convention question, not a code fix: are `Run:` and
`Result:` *steps* (hash them) or *results of record* (writable)?

**Recommendation:** `Run:` is always a step. `Result:` is ambiguous (expected
vs observed) — split it, or treat an expected-result field as a step. Strip a
table row only when it sits under a `Runs` heading, not every `|` line.

**Why now:** as of 2026-09-21 no spec in devx or palateful carries
`red_eval_shas`, so changing what is hashed costs no migration. It will never
be cheaper.

## Acceptance criteria

1. A decision recorded for each of B/C, D and H, with the rationale.
2. For whatever is decided: a test that FAILS on current `main` reproducing the
   bypass, then passes on the fix.
3. Skill prose (`.claude/commands/devx.md` Phase 5, `devx-plan.md` 2b and their
   `skills/` mirrors) updated to match — the "What `--verify` does not catch"
   paragraph shipped with the review must be narrowed or removed accordingly.

## Status log

- 2026-09-21T11:30-06:00 — filed from the retroactive 3-agent review of #164
  (debug-75563d). All four reproduced against current `main`; B and D rated
  HIGH, C and H MED. Deliberately NOT fixed in the review PR because each
  changes the lock's semantics; recommendations carried above.

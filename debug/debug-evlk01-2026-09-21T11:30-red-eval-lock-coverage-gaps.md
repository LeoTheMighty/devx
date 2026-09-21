---
hash: evlk01
type: debug
created: 2026-09-21T11:30:00-06:00
title: "RED eval lock only guards files it already recorded — added, re-pointed and stripped evals bypass it"
from: debug/debug-75563d-2026-09-02T09:20-red-eval-sha-lock-unwired.md
spawned: []
status: done
owner: null
branch: fix/evlk01-lock-coverage
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

- [x] 1. A decision recorded for each of B/C, D and H, with the rationale.
- [x] 2. For whatever is decided: a test that FAILS on current `main` reproducing the
   bypass, then passes on the fix.
- [x] 3. Skill prose (`.claude/commands/devx.md` Phase 5, `devx-plan.md` 2b and their
   `skills/` mirrors) updated to match — the "What `--verify` does not catch"
   paragraph shipped with the review must be narrowed or removed accordingly.

## Status log

- 2026-09-21T11:30-06:00 — filed from the retroactive 3-agent review of #164
  (debug-75563d). All four reproduced against current `main`; B and D rated
  HIGH, C and H MED. Deliberately NOT fixed in the review PR because each
  changes the lock's semantics; recommendations carried above.
- 2026-09-21T12:40-06:00 — **decisions (Leo, 2026-09-21, relayed by the coordinator session), each taking the recommendation above:**
  - **D:** `devx revise` is the path for a genuinely changed expectation; no new mechanism, no `--restamp`. A changed expectation IS a revision, and a second waiver-shaped mechanism is how finding A of the #164 review happened. `revise` already re-opens the red stage and — since #170's fix G — clears the stamp.
  - **B/C:** record `gate_status.evals_locked: true` at stamp time; in a locked workstream an unstamped or re-pointed eval BLOCKS; never-locked workstreams stay advisory so grandfathering holds.
  - **H:** hash `Run:`; strip table rows only under a Runs heading; state the `Result:` convention explicitly. **Resolved as: `Result:` is the OBSERVED result of a run (writable); an expected result is written `Expected:` or `Threshold:` (locked).** Grounded in real usage: across all 14 eval `.md` files in devx and palateful, the only structured labels used were `verdict:` (3), `threshold:` (2), `status:` (2) — no eval used `Run:`, `Result:`, or a Runs heading, so the convention was set on clear ground and broke nothing. `threshold:`, the label actually in use for a bar, was already hashed.
- 2026-09-21T12:40-06:00 — implemented. Gate 4 now writes `gate_status.evals_locked` and `gate_status.red_eval_ids` (every E-id it knew → the artifact it ran, or `null` when known but not stamped). `--verify` re-resolves the eval set exactly as the gate does (dry run, no execution) and checks it against the map. `stepBody` hashes `Run:` and scopes table stripping to a Runs section. 15 tests fail on pre-evlk01 `main` and pass here.
  - **The `null` is load-bearing.** `--verify` resolves without the gate-time `--waive`, so a waived eval reappears as runnable; recorded as known-but-unstamped it never false-blocks. An E-id maps to its artifact only if that artifact EXISTED at gate time (see Phase 4, M5).
- 2026-09-21T13:35-06:00 — phase 4: 3-agent parallel adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor) of this story's own diff, run BEFORE the PR — the step #164 skipped. Reviewers were given pinned base/head SHAs because `main` moved under the branch. **17 findings after deduplication (3 HIGH, 6 MED, 8 LOW); 14 fixed in-place, 3 recorded and deliberately not fixed.** Verdict from the Blind Hunter was *block*; the review earned its place.
  - **H1 (HIGH) — a locked eval could leave the run set unchecked.** `--verify` walked only the evals running NOW, so re-pointing E-1 at a softened copy AND reclassifying it `tests-after` in one edit verified clean, as did reclassifying to `human` or deleting the expectation. Fixed: every LOCKED E-id is now checked too, and one that no longer runs reports `dropped` (blocks). The subtlety: shipped-green deferral is a LEGITIMATE way to leave the run set (every multi-phase workstream after phase 1 ships), so blocking on "no longer runs" would have been a false block. `--verify` therefore resolves with shipped deferral OFF — a shipped eval comes back runnable with its real artifact, so re-pointing it is still caught, while only a validation-type change reads as `dropped`. This also removed the gate-vs-verify `donePhases` drift the edge hunter found, and reuses the gate's artifact resolution rather than re-implementing it.
  - **H2 (HIGH) — deleting `expectations.md` switched the coverage check off.** The whole check sat inside `if (exists(expectations))`. Fixed: in a locked workstream a missing expectations file or plan reports `unverifiable` and blocks.
  - **H3 (HIGH) — tool-written files falsely blocked.** A vitest `__snapshots__/*.snap` from the first green run, a `.DS_Store`, or `__pycache__` under a stamped directory read as `unstamped`. Fixed with an ignore list applied only while EXPANDING a directory, in the one function stamp and verify both read through.
  - **MED:** fenced code blocks were not tracked, so a `# Runs the bench` shell comment opened a Runs section and un-hashed every later table (M1 — fixed; fenced content is now always locked, and 4-space-indented lines are no longer headings). `RUNS_HEADING_RE = /^runs\b/i` matched `Runs per worker` / `Runs-per-second thresholds` (M2 — now anchored at both ends). `locked` ignored a non-empty E-id map, so deleting two lines unlocked everything (M3 — the map now proves a lock). A workstream stamped BEFORE evlk01 had shas but no map and hard-blocked on every eval with the false message "added after Gate 4" (M4 — now sha-locked only: stamped files still re-hashed, set findings advisory and worded neutrally). An EMPTY directory artifact accepted as RED mapped to `null`, leaving every later test unguarded (M5 — E-ids now map by the artifact's EXISTENCE at gate time, not by whether anything was stamped; this separates it from a P1 whose file did not exist yet). The dormant L1 guard's deny message still recommended re-running the gate (M6 — fixed; its test had been PINNING the ruled-out advice).
  - **LOW, fixed:** the C test failed on old code for the wrong reason (a missing field) rather than the bypass — reordered into a true repro; test gaps on carry-forward and heading anchoring (each surviving mutation now caught); setext `Runs` headings, a `Runs:` field line and `Status:` over a `---` rule read as `moved` (fixed); a JSDoc left detached from its function; prose that overstated grandfathering and omitted the null-mapped exceptions.
  - **LOW, recorded, NOT fixed, and NOT filed as follow-ups** (stated plainly because "filed as a follow-up" with nothing behind it is the defect this workstream spent 2026-09-20 removing from 75563d):
    - Hand-setting a `red_eval_ids` entry to `null` disables re-point detection for that E-id. Inherent to trusting agent-editable frontmatter; the real control is write-time protection of the spec itself (debug-evlk02).
    - `outcome tune` clears the WHOLE lock rather than only the re-opened E-ids. Pre-existing for the shas since #164; evlk01 extends the same clearing to the marker and map for consistency. A design question about tune's scope, not a regression.
    - Re-gating onto artifact `b` then pointing back to `a` reads `repointed` even though `a` is still stamped. Conservative; accepted.
    - Convention, documented rather than parsed: record runs as a TABLE under `## Runs` (a bullet-list Runs section is locked) and keep `Result:` to one line.
  - **Two self-caught defects during the fix pass,** neither found by a reviewer: a regex that went through a raw Python string landed as `\\(` (a literal backslash plus a group) and would never have matched, so a finding message printed a raw verdict; and M4's advisory findings initially mislabelled stamped evals as "added after Gate 4". Both fixed.
  - **Verification.** Every Phase 4 fix is load-bearing by mutation: 12 mutations, one per fix, all CAUGHT — the one that first SURVIVED (a fresh `null` erasing an earlier artifact) exposed a real test gap, since the existing test went through `--waive` and so never exercised the runs-loop branch; a delete-and-re-gate test now covers it. 579 tests across all 21 files that consume the engine frontmatter pass; typecheck clean; skill mirrors in sync; prose budget holds. Rebased over 9 commits of `main` that touched three of the same files; merged cleanly and re-verified, but not re-reviewed by a second 3-agent pass.

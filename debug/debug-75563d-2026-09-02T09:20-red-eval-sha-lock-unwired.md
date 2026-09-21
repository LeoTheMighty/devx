---
hash: 75563d
type: debug
created: 2026-09-02T09:20:00-06:00
title: "RED eval sha lock is unwired — Gate 4 never calls stampEvalShas()"
status: in-progress
from: plan/plan-a494be-2026-09-01T14:31-docs-layout-resolution.md
blocked_by: []
branch: null
owner: /devx-2026-09-20T1822-39853
---
## Goal

`gate_status.red_eval_shas` is written on every Gate 4 PASS, so
`verifyStepBodies()` has something to verify and `/devx` Phase 5's hard stop
can actually fire.

Today it never is. `stampEvalShas()` (`src/lib/engine/evals-lock.ts:85`) has
**zero callers in `src/`** — the library shipped, the call site did not. Every
workstream that passes Gate 4 comes out unstamped, which the lock's own
grandfathering rule reads as "predates the stamp": unstamped evals report,
never block. So the lock is silently inert for every workstream in the repo,
including new ones.

## Acceptance criteria

- [ ] AC 1: Repro exists — a test that runs `devx gate evals <hash>` to PASS
      on a fixture and asserts `gate_status.red_eval_shas` is written with one
      entry per run eval. It must FAIL against `main` today.
- [ ] AC 2: Root cause documented with evidence in the status log
      (`grep -rn "stampEvalShas" src/` returns only the definition).
- [ ] AC 3: Gate 4 stamps on PASS, and `verifyStepBodies()` reports `moved` /
      `missing` against a stamped workstream. `/devx` Phase 5's hard stop
      fires on a `moved` body.
- [ ] AC 4: Decide and record what `stepBody()` means for a `.ts` eval.
      `stepBody()` is written for step-bearing markdown — it strips
      "result of record" LINES (`Status:`, `Last run:`, `| … |` rows). Applied
      to a `.ts` script the whole file is step body, which is probably right
      but is currently unstated; a `.ts` eval that prints a markdown table
      row would have that line silently stripped from its own hash.
- [ ] AC 5: Existing unstamped workstreams stay grandfathered — this must not
      retroactively block a workstream whose Gate 4 predates the fix.
- [ ] AC 6: The two shipped skill bodies that describe the lock as ACTIVE
      (`.claude/commands/devx.md` "Fix the code, not the eval";
      `.claude/commands/devx-plan.md` RED stage step 2b) either become true or
      are corrected. Both currently assert behavior no code implements.

## Technical notes

Found during `/devx red a494be` (2026-09-02): Gate 4 returned PASS with all 8
evals recorded `right-reason`, and the plan spec's frontmatter carried no
`red_eval_shas` key at all.

This is the same defect class as the workstream that found it —
`docs-layout-resolution` exists because `engine.docs_layout` is documented as
load-bearing and read by nothing. Worth noting at that workstream's retro:
"a shipped library with no call site" and "a documented key with no reader"
are the same failure wearing different clothes, and neither has a mechanical
guard today.

CLAUDE.md § "Fix the code, not the eval" also states the lock as fact.

## Status log

- 2026-09-20T18:40 — **implemented.** Root cause and scope both turned out
  wider than filed.

  **AC 2 — root cause, with the archaeology the fix rested on.**
  `grep -rn "stampEvalShas" src/` returns the definition only
  (`evals-lock.ts:85`). Stronger: `git log --all -S "stampEvalShas(" -- src/`
  returns **only the commit that introduced it** (`02c2f2d`, 2026-09-01, the
  8am-harness fold-in) — so it never had a caller in the repo's history.
  **Born inert, not a regression.** Nothing "stopped working", so there was
  no moment anyone could have noticed.

  **Nothing got through, and that is measurable rather than hoped.** Dating
  every Gate-4 PASS by when `evals_red: true` landed in each plan spec:
  b3f7a1 07-14 · eac479 07-24 · e0a67e 07-28 · 20eb6f 07-28 · 620c74 07-30 ·
  62bcd1 08-02 · bd5b5e 08-19 · c8e2d4 08-21 · a494be 09-02. The lock exists
  from 09-01, so **eight of nine workstreams passed Gate 4 before it existed**
  and were never in scope — AC 5's grandfathering is correct for them by
  construction, not by luck. Exactly one workstream passed through the window
  where the lock should have bound: `a494be`, and that is the workstream that
  found this bug. The "go look at what got through" audit is therefore
  **closed**, not open.

  **Scope was wider than filed: ALL THREE layers were unwired, not just L2.**
  `verifyStepBodies`, `blocksVerification` and `evalsGuardDecision` also had
  zero consumers. Shipping only the stamp would have made this fix its own
  specimen of "computed and never read" (cf. `debug-inert1`), so L3 ships
  with it:
  - **L2** — `stampEvalShas` wired at `commands/gate.ts`'s `evals_red` write
    site, via a new `EnginePatch.redEvalShas` / `EngineState.redEvalShas`
    field. `gate_status.red_eval_shas` lives under `gate_status:` in YAML but
    is **not** a gate flag (`GateStatus` is a 4-key boolean map), so it is
    carried as its own field; the flag reader iterates `GATE_FLAGS` by name
    and is blind to the sibling key.
  - **L3** — `devx gate evals <hash> --verify`: re-hashes the stamped evals,
    exits 1 on `moved`/`missing`, 0 otherwise. Runs nothing, writes nothing.
  - **L1** (the PreToolUse `evalsGuardDecision` hook) is still unwired —
    deliberately out of scope, filed as a follow-up.

  **Decisions made, with reasons:**
  - **Stamp on every NON-FAIL verdict, not only PASS.** The condition that
    matters is the one at the write site: `evals_red` flips and execution
    begins. A CONCERNS or WAIVED workstream implements against these evals
    exactly as a PASS does, so leaving either unstamped would make `--waive`
    a **silent lock bypass** — recording an operator override while quietly
    dropping an immutability the override was never asked to waive.
  - **Deferred evals are NOT stamped.** A `human`/waived/shipped-green eval
    was never observed RED, and the lock's entire claim is "watched failing
    for the right reason". Locking an unobserved body would manufacture
    evidence.
  - **Keys are REPO-relative**, the form `EvalRun.artifact` already carries
    (`gate-evals.ts:474`). The `RedEvalShas` docstring said
    "workstream-relative"; that is impossible in general, because
    `resolveArtifactPath` resolves non-`evals/` targets against the repo root
    and a phase verified by `test/foo.test.ts` has no workstream-relative
    spelling. Docstring corrected. **Known limitation:** `devx archive` /
    `devx layout migrate` move a workstream, and repo-relative keys then read
    as `missing`. That direction is safe (reports, never silently passes) but
    it is a real follow-up.
  - **AC 4 — `stepBody()` applies to `.md` only.** New `lockableBody(path,
    raw)` hashes a non-markdown eval **whole**. Running the markdown
    result-of-record stripper over a `.ts` eval is silently destructive: a
    script whose source contains `| date | RED |` or a `Status:` line (a
    template literal, a fixture, a comment) would have that line stripped
    from its own hash, so editing it later would not register as `moved`.
    The rule lives in `evals-lock.ts` so the **stamp and the verify cannot
    disagree** — my first pass put it in the collector, i.e. on one side of
    the lock only, which would have been a fresh instance of the same class.
  - **Re-stamp REPLACES the map** rather than merging. Merging would strand
    a deleted eval's sha forever, where `verifyStepBodies` reads it as
    `missing` and blocks a workstream on an eval nobody removed improperly.
  - **A missing/unreadable artifact is skipped, never stamped empty.** An
    empty sha would lock the eval to "absent" and read the real file as
    `moved` on the next run.

  **AC 1 — the repro.** 13 tests in `test/gate-verdict-persist.test.ts`
  (`describe("gate evals — RED step-body stamp")` + the `--verify` block).
  They fail against `main` by construction: `EngineState.redEvalShas` does
  not exist there, so they do not compile, let alone pass.

  **AC 6** — `.claude/commands/devx.md`'s "Fix the code, not the eval" now
  names the mechanical check (`--verify`, exit-1 hard stop) instead of
  asserting behaviour no code implemented. Mirrored to `skills/` via
  `npm run sync:skills` (pin101 drift guard).

  **AC 6 could not be an ADDITION — the S-1 tripwire has ~51 bytes of
  headroom.** The first draft appended ~900 bytes of Phase 5 prose and
  failed `test/engine-prose-budget.test.ts` at 123,479 bytes against a
  122,880 ceiling. Trimming the addition was not enough (123,119). The fix
  was to REPLACE the existing paragraph rather than extend it: the old
  prose spent ~470 bytes asserting a lock that did not work, and the
  command that enforces it says the same thing shorter. Net **−354 bytes**
  — the skill body got smaller while becoming true. Worth recording as the
  general rule: on this repo a skill-prose change is a **budget
  reallocation**, not an append, and the binding limit is S-1 (~51 bytes
  free), not the canary (~6KB).

  **Proxy register entry for this gate**, per `plan-4c827d`:
  *proxy* = `red_eval_shas` is stamped; *claim* = the eval gating this story
  ran against this SHA. Before today those diverged in the strongest possible
  way — the proxy was never written, so the claim was unsupported by
  construction, and the grandfathering rule read the absence as permission.
  That is the "silence and cleanliness must not look identical" property, and
  it is why AC 5's grandfathering had to stay **advisory-only** rather than
  becoming a blocker: the fix must not convert eight historical workstreams
  into failures.

- 2026-09-02T09:20 — filed during `/devx red a494be`. Evidence:
  `grep -rn "stampEvalShas" src/` → definition only
  (`src/lib/engine/evals-lock.ts:85`), no caller. Gate 4 PASS on `a494be`
  wrote `gate_verdicts.evals: PASS` and `evals_red: true` but no
  `red_eval_shas`. Out of scope for the RED stage that found it.
- 2026-09-20T18:22:49-06:00 — claimed by /devx in session /devx-2026-09-20T1822-39853

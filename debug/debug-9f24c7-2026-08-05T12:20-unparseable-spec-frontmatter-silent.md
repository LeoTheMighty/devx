---
hash: 9f24c7
type: debug
created: 2026-08-05T12:20:00-06:00
title: "Unparseable spec frontmatter reads as an empty block everywhere — 5 shipped specs were invisible to the engine"
from: dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md
status: in-progress
owner: /devx-interactive-2026-08-21-harness-sweep
---

## Goal

A spec whose frontmatter YAML does not parse should be reported, not
silently treated as a spec that records nothing.

`readEngineState` (`src/lib/engine/frontmatter.ts`) parses with
`parseDocument` and never inspects `doc.errors`. On a parse failure it
returns the all-defaults `EngineState`: `status: null`, `blockedBy: []`,
`phase: null`, `plan: null`, all gate flags `false`. That is the correct
posture for a READER that must not crash a gate — but it is indistinguishable
from a spec that genuinely records none of those things, and every consumer
inherits the confusion: `devx next`, `reconcile`, the loop's pick, the gate
CLIs, `resolveSpecWorkstream`, and the graph model all read the same
function.

Found by `devx graph backfill`'s first real run (sgr106): the completion pass
proposed writing `blocked_by: [mgr101]` onto `dev/dev-mgr102`, which already
had exactly that line. The edge was not missing; the file was unreadable.

**Five shipped specs were affected**, in two shapes, both an unquoted
`title:` scalar:

- `title: State persistence: schedule.json + …` — a bare `: ` inside a plain
  scalar (`dev-mgr102`, `dev-mgr103`).
- ``title: `devx --help` listing…`` — a leading backtick, a YAML reserved
  character (`dev-cfg204`, `dev-cli303`, `dev-cli304`).

sgr106 fixed those five data instances (quoted the titles) and added
`frontmatterParseError(content)` next to `readEngineState`, which backfill
uses to report the class instead of writing through it. **The class itself is
still open**: the next hand-authored spec with a colon or backtick in an
unquoted title goes invisible again, silently.

## Acceptance criteria

- [ ] AC 1: Repro — a fixture spec with an unquoted `title:` containing `: `
      is shown to read as an empty `EngineState`, with its real `status:`
      and `blocked_by:` lost. Committed as a failing/asserting test.
- [ ] AC 2: A mechanical guard so the class cannot recur silently. Preferred
      shape: a suite assertion that every spec under the type dirs parses
      (`frontmatterParseError` returns null) — it is one readdir and runs in
      CI on every PR. `devx doctor` (dev-db36af) is the natural second home
      for the `--fix` half.
- [ ] AC 3: Decide and record whether `readEngineState` should keep failing
      soft. Recommendation: yes, keep it soft — but every call site that can
      report (the gates, `devx next`'s drift rows, `devx status`) should
      consult `frontmatterParseError` and say "unreadable" rather than
      render a confident empty state. Do not change the reader's return
      shape without a survey of consumers.
- [ ] AC 4: Confirm no OTHER durable state was lost while these five were
      unreadable — in particular whether any gate verdict, `phase:`, or
      `blocked_by:` on the five was acted on as absent (all five are
      `status: done`, so the blast radius is expected to be nil; verify,
      don't assume).

## Technical notes

- `applyEnginePatch` already fails LOUD on the same input (it throws when
  `doc.errors.length > 0`), so reader and writer disagree about the same
  file. That asymmetry is the bug's fingerprint and a good place to start.
- Do NOT "fix" this by making `readEngineState` throw — a half-edited spec
  crashing a gate is the failure mode the soft posture was chosen to avoid.
- `frontmatterParseError` already exists (sgr106) and returns the first YAML
  error message; the guard in AC 2 should wrap it, not re-implement it.

## Status log

- 2026-08-05T12:20 — filed from sgr106 Phase 4/Phase 5 (the attended backfill
  run surfaced it; 5 data instances fixed there, class left open here).
- 2026-08-19T23:39:52-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-20T06:10:48.352Z — loop iteration 1: Shipped AC 1 (the silent-loss repro, correcting the spec's premise about how the loss actually manifests) and AC 2 (a repo-wide frontmatter-parse canary), which caught and fixed two live instances including a recurrence of the class filed after this spec.
  - Change: AC 1: added a repro block to test/engine-frontmatter.test.ts pinning the true read semantics of both broken shapes — the colon shape swallows all keys below the title and is toEqual-identical to a genuinely blank spec; the backtick shape errors but reads losslessly. Also pinned the reader/writer disagreement (readEngineState succeeds where applyEnginePatch throws) as the bug's fingerprint.
  - Change: AC 2: new test/spec-frontmatter-parses.test.ts — a repo-wide canary wrapping frontmatterParseError over all seven spec type dirs, plus a frontmatter-hash-vs-filename-hash parity assertion and a non-vacuous-scan guard.
  - Change: Fixed the live recurrence debug/debug-7b3e2a (filed 2026-08-07, after this spec) by single-quoting its unquoted title; its status/from/plan/owner/branch were invisible to every engine consumer.
  - Change: Fixed readEngineState to read `hash:` from the raw plain-scalar source rather than toJS(), so an all-digit hash (debug-620337) is no longer dropped — with unit tests proving the String() coercion alternative would silently corrupt 012345 and 0x1234 into different hashes.
  - Learning: The spec's core premise is inaccurate: an unparseable block does NOT read as the all-defaults EngineState. parseDocument().toJS() never throws on either shipped shape, so readEngineState's catch is dead code for this class. The colon shape loses keys POSITIONALLY (everything below the bad title); the backtick shape loses nothing at all on read.
  - Learning: Only 2 of the 5 'affected' specs (mgr102, mgr103) actually lost data — verified against the real pre-fix bytes at 66720bd^. cfg204/cli303/cli304 read every field correctly; their only impairment was that applyEnginePatch refused to write to them, freezing rather than blanking them.
  - Learning: The class already recurred before this spec was worked: debug-7b3e2a was filed 2026-08-07 with the exact colon shape. The guard is not hypothetical protection — it had two live catches on its first run.
  - Learning: A distinct silent-loss shape lives in the same function: a spec hash of six digits (620337) is a legal YAML integer and read as null. String() coercion is NOT a safe fix — 012345 parses to 12345 and 0x1234 to 4660, either of which resolves to a different spec than the file the bytes came from. Reading the plain scalar's own source is the only lossless answer.
  - Learning: AC 4's blast radius is structurally nil for a reason worth recording in the AC 3 decision: src/lib/next/gather.ts:197 does `effectiveStatus = specStatus ?? row.status`, so a nulled spec status silently falls back to the backlog row — and the same null also suppresses the drift warning on the very next line. The backlog row is a second durable source that masked the loss.
  - Learning: graph/model.ts keys specs by FILENAME hash (specFilenameHash), not frontmatter hash — which is why the numeric-hash bug never surfaced on the board and why the graph was never at risk from it.
  - Learning: A spec-named file with NO frontmatter block at all (test/test-2e7b45, a QA walkthrough parked in the spec dir) is invisible to every frontmatter reader, and AC 2 as written deliberately permits it since frontmatterParseError returns null for that condition. Worth an explicit call in AC 3 on whether that should be reported too.
  - Learning: This repo has no `lint` npm script; the local gate is `npm test`, which itself &&-chains schema smoke, two tsx tests, build, typecheck, then the parallel and blocking vitest configs. Piping it to `tail` discards the parallel leg's summary and masks the real exit code — but the presence of the blocking leg's summary proves every earlier link passed.
- 2026-08-20T07:10:52.067Z — [ERROR] loop iteration 2: worker session exceeded the 60min awake-time iteration ceiling and was killed
- 2026-08-20T07:45:11.557Z — loop iteration 3: Shipped AC 3 (D-13: the reader stays soft, and devx next / devx status / every gate now report "unreadable" instead of asserting a confident empty state) and AC 4 (a 624-revision history sweep proving durable-state loss is nil), with the full local gate green.
  - Change: AC 3 wiring: `devx next` emits a new `frontmatter-unreadable` drift kind (gather.ts + decide.ts), `devx status` warns per unreadable plan spec before the stage check rather than dropping it silently, and every gate warns once at the shared `resolveOrFail` choke point via a new additive `ResolvedWorkstream.frontmatterError`.
  - Change: AC 3 decision: recorded D-13 in v2/07-decisions.md (soft reader locked, the three reporting sites, the advisory/CAP-2 contract, and the explicit corollary that a file with no frontmatter block at all stays legal and silent), cross-referenced from readEngineState's docblock so the next person to touch the return shape sees the consumer survey.
  - Change: AC 3 tests: new test/frontmatter-unreadable-reported.test.ts (9 tests) pinning each report against the silence it replaces — including that the gate names the parse error BEFORE applyEnginePatch's write-side failure, and three negative cases proving the guards aren't vacuous.
  - Change: AC 4 verification: re-parsed all 624 historical revisions of all 202 spec files; exactly 6 were ever unreadable (the 5 named + debug-7b3e2a), no plan spec ever among them, so no gate verdict/stage/entered_at/outcome/phase was ever read as absent. Conclusion recorded in D-13.
  - Learning: The five 'affected' specs were not the whole picture and the sgr106 commit is misleading on this: it also touched dev-db36af and plan-b01000, but those two parsed fine — their blocked_by changes were the backfill's edge ADDITIONS, not restorations of lost data. Diffing the commit's file list would overcount the blast radius; only a before/after engine-state diff distinguishes the two.
  - Learning: `devx gate prd` on a colon-shape spec exits 2 with 'PASS computed but frontmatter write failed' — the reader resolved the workstream and the gate computed a real verdict, then applyEnginePatch refused the bytes. So the gates were never fully silent about this class; they were LOUD in a way that reads as a writer bug and points at the wrong file. Naming the unreadable spec first is the actual fix, not adding a report where there was none.
  - Learning: The exhaustive-history sweep is cheap and worth reusing: `git log --format=%H -- <path>` per spec file piped into a single `git cat-file --batch` re-parsed 624 revisions in seconds. Note spawnSync rejects `encoding: 'buffer'` on Node 24 — omit the option to get Buffers back.
  - Learning: DriftEntry.kind has no exhaustive switch outside src/lib/next/ — `devx next` passes `drift` through to JSON verbatim and only counts it in the human line — so adding a kind is purely additive. The similar-looking 'in-progress-without-lock' strings in verify-claim.ts and the /devx skill body are a SEPARATE vocabulary that happens to share a spelling; don't assume they're the same union.
  - Learning: Piping `npm test` to `tail -80` also truncates the saved background-task output file, so the parallel leg's summary is unrecoverable afterward. The &&-chain still proves it passed (the blocking leg can't start otherwise), but capture the file unpiped if you want the evidence. The full run took 24 minutes here — over a third of the 60-minute iteration ceiling that killed iteration 2.
- 2026-08-20T14:37:51.285Z — [FAIL] loop abandoned 9f24c7: push failed (commit preserved locally): ssh_dispatch_run_fatal: Connection to 140.82.114.3 port 22: Broken pipe; worktree preserved at .worktrees/debug-9f24c7
- 2026-08-21T11:10 — revived interactively: the three loop commits were intact and unpushed, only the push leg had failed. Rebased onto main (one status-log conflict, resolved by keeping both histories in order), full local gate green (122/122 parallel + 29/29 blocking, 3564 tests). No code re-done; ACs 1-4 stand as the loop shipped them.

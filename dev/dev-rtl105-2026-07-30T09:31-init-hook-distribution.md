---
hash: rtl105
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Hook registration template + `/devx-init` distribution"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 5
status: done
owner: /devx-loop-2026-07-30T16-02-29-879-60783
blocked_by: [rtl101]
branch: feat/dev-rtl105
---

## Goal

Consumer repos inherit the listener with zero per-repo setup: an idempotent,
ownership-respecting hook-install step in `/devx-init`, plus the shipped
template fragment. (This repo's own activation already landed with rtl101.)
Plan phase 5 of workstream retro-listener; RED artifact `evals/E-8` defines
the contract and must flip green.

## Acceptance criteria

- [ ] AC 1: `src/lib/init-hooks.ts` exports `installHooks({repoRoot,
      settingsPath?, dryRun?})`: parse-or-create `.claude/settings.json`,
      deep-merge the Stop/SessionEnd registrations (devx-owned entries
      identified by the command string `devx learn-helper listen`),
      preserve unknown top-level keys and existing user hook entries
      byte-intact and in their original order, `writeAtomic` output,
      per-file `{action: created|merged|unchanged, path}` result.
- [ ] AC 2: `_devx/templates/init/claude-settings-hooks.json` ships the
      fragment (already covered by `package.json → files`); a test asserts
      the fragment agrees with this repo's committed `.claude/settings.json`.
- [ ] AC 3: `src/lib/init-orchestrator.ts` wires the install step,
      user-foreground only (settings-edit confirmation prompts are
      acceptable at init; never install hooks from a subagent — memory
      `project_skill_perms_block_subagents.md`).
- [ ] AC 4: `test/learn-hook-install.test.ts` green: run-twice 0-byte diff,
      user entries survive byte-intact AND ordered (0 removed, 0
      reordered), created-vs-merged-vs-unchanged actions, fragment
      agreement; eval `E-8` exits 0.
- [ ] AC 5: `MANUAL.md` gains the day-one ownership entry: start
      `devx learn-watch` in a spare terminal (the watcher is opt-in; the
      deferred pending-count surfacing in `devx status`/`devx next` is
      noted there as the follow-up option).

## Status log

- 2026-07-30T09:31 — emitted by /devx-plan RED stage (workstream 620c74).
- 2026-07-30T14:07:31-06:00 — claimed by /devx in session /devx-loop-2026-07-30T16-02-29-879-60783
- 2026-07-31T15:15:04.321Z — loop iteration 1: Implemented the full rtl105 surface — `installHooks()` library, shipped settings fragment, `/devx-init` orchestrator wiring, MANUAL.md ownership entry, and a dedicated test suite — but the local gate run was cut off mid-run, so green is unverified.
  - Change: Added `src/lib/init-hooks.ts` exporting `installHooks({repoRoot, settingsPath?, dryRun?})`: parses-or-creates `.claude/settings.json`, deep-merges the devx-owned Stop/SessionEnd registrations keyed on the `devx learn-helper listen` command string, preserves unknown top-level keys and existing user hook entries byte-intact and in original order, writes atomically, and returns per-file `{action: created|merged|unchanged, path}` (AC 1).
  - Change: Shipped `_devx/templates/init/claude-settings-hooks.json` as the distributable hook fragment, covered by the existing `package.json → files` glob (AC 2).
  - Change: Wired the hook-install step into `src/lib/init-orchestrator.ts` as a user-foreground-only step, so settings-edit confirmation prompts land in the interactive init session and never in a subagent (AC 3).
  - Change: Added `test/learn-hook-install.test.ts` covering run-twice 0-byte diff idempotence, user-entry survival (0 removed, 0 reordered), created/merged/unchanged action reporting, and fragment-vs-committed-settings agreement; extended `test/init-e2e.test.ts` with orchestrator-wiring assertions (AC 4, unverified green).
  - Change: Added the day-one ownership entry to `MANUAL.md`: start `devx learn-watch` in a spare terminal, with the deferred `devx status`/`devx next` pending-count surfacing noted as the follow-up option (AC 5).
  - Learning: The full local gate on this worktree runs long enough to cross 20 minutes of wall-clock heartbeats; starting it and then doing diff review in the same turn risks losing the result to a connection drop. Kick the gate off and treat its summary line as the single thing that must be captured before anything else in the turn.
  - Learning: AC 4's 'user entries survive byte-intact AND ordered' forces the merge to be an in-place array splice keyed on the devx command string rather than a filter-then-append — appending devx entries at the tail reorders relative to user entries that were originally after them.
  - Learning: Every acceptance criterion's code surface exists in the working tree, but none of it is verified: the `E-8` eval exit code and the suite result were never observed. The next iteration's only remaining work is running the gate + eval and fixing whatever they surface.
- 2026-07-31T15:18:30.461Z — loop iteration 2: Verified the rtl105 hook-install surface end-to-end (typecheck clean, E-8 eval exit 0, 35/35 targeted tests green) and identified that the /devx-init upgrade path skips hook installation entirely.
  - Change: Ran verification on the code iteration 1 left unverified: `npm run typecheck` passes clean, the `E-8_hook-install.ts` eval exits 0 (satisfying AC 4's eval requirement), and `test/learn-hook-install.test.ts` + `test/init-e2e.test.ts` pass 35/35 including the three new rtl105 orchestrator-wiring cases.
  - Change: Started the full local gate in the background with a waiter armed, so the long vitest run cannot be truncated mid-turn (per the never-kill-the-gate rule).
  - Learning: `runInit` routes existing-devx repos to `runInitUpgrade` and returns early, skipping the fresh-init phases — so the hook-install step added in iteration 1 only fires on fresh init. Every repo that already has devx (the common path, including this one) would never inherit the listener registration, which defeats the spec Goal's "zero per-repo setup."
  - Learning: Upgrade mode has an extensible `RepairSurface` registry (`pr-template`, `engine-templates`, `personas`, …) — that is the idiomatic distribution path for already-initialized repos. The fix is a `listener-hooks` entry whose detector wraps `installHooks({dryRun: true}).action === "unchanged"` and whose repairer wraps `installHooks()` — reuse of the existing library, not duplicated logic.
  - Learning: The claim-contention tests push to temp sandbox origins during the gate run; those push lines in the output are not real-remote activity and should not be mistaken for one.
- 2026-07-31T15:40:53.083Z — loop iteration 3: Closed the upgrade-path gap by adding a `listener-hooks` repair surface to `/devx-init`, so already-initialized repos inherit the retro listener — full local gate green at 2911/2911.
  - Change: Extracted the install+degrade-to-MANUAL policy out of init-orchestrator into `installHooksOrFileManual()` in src/lib/init-hooks.ts, so the fresh and upgrade paths share one implementation and identical failure copy instead of duplicating the merge/MANUAL logic
  - Change: Added a `listener-hooks` RepairSurface to src/lib/init-upgrade.ts — detector is `installHooks({dryRun: true}).action === "unchanged"`, repairer is the shared wrapper — closing the hole where every already-initialized repo (the common path, including this one) would never get the registration
  - Change: Covered both new arms with tests: 3 wrapper cases in test/learn-hook-install.test.ts and 2 upgrade e2e cases in test/init-e2e.test.ts (registers on upgrade, re-run is a 0-byte diff, unclassifiable settings yields repaired:false + a MANUAL bullet with the user's file byte-intact); updated ALL_SURFACES and the partial-on-devx `added` expectation 3 → 4
  - Change: Recorded the fresh-path-is-not-enough reasoning in the retro-listener design doc's Install section
  - Change: Ran the full local gate to completion: 136/136 test files, 2911/2911 tests, exit 0; typecheck clean; E-8 eval exits 0
  - Learning: Adding a RepairSurface silently changes two kinds of existing assertions: any test enumerating surfaces (init-upgrade.test.ts's ALL_SURFACES, which feeds presentForAll/noopRepairs) and any test asserting an exact `added` count with the new surface left un-stubbed (the partial-on-devx e2e). Both fail loudly, but the enumeration one is easy to miss when writing the surface itself.
  - Learning: The upgrade path's safeDetect/safeRepair pair composes correctly with a throwing installer for free: an unparseable settings.json throws in the detector, safeDetect's assume-missing bias routes to the repairer, which re-raises the same refusal and degrades to MANUAL.md — so `repaired: false` is an honest summary entry, never a clobbered user file. No special-casing was needed.
  - Learning: A tight `until <cond>; do :; done` busy-wait as a gate waiter is actively harmful — it competes with vitest for CPU on the same box. The harness also blocks bare `sleep N &&` chains; the working shape is a background `until ...; do sleep 20; done` or a Monitor.
  - Learning: The engine prose-budget canary (S-1, 60KB) measures only `_devx/templates/engine/*.md` plus the stage skill sections — workstream artifacts like design.md are not counted, so editing them for accuracy is budget-free.
- 2026-07-31T15:43:39.944Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-07-31T15:43:39.944Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/108

## Links

- Plan: `_devx/workstreams/retro-listener/plan/agent.md` §Phase 5
- Design: `_devx/workstreams/retro-listener/design/agent.md` §Architecture (Install)

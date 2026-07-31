---
hash: rtl105
type: dev
created: 2026-07-30T09:31:00-06:00
title: "Hook registration template + `/devx-init` distribution"
from: plan/plan-620c74-2026-07-29T11:56-retro-listener.md
plan: _devx/workstreams/retro-listener
phase: 5
status: in-progress
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

## Links

- Plan: `_devx/workstreams/retro-listener/plan.md` §Phase 5
- Design: `_devx/workstreams/retro-listener/design.md` §Architecture (Install)

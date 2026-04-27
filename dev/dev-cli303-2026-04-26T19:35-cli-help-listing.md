---
hash: cli303
type: dev
created: 2026-04-26T19:35:00-07:00
title: `devx --help` listing with phase + epic annotations
from: _bmad-output/planning-artifacts/epic-cli-skeleton.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
blocked_by: [cli302, cfg204]
branch: feat/dev-cli303
owner: /devx
---

## Goal

Customize `commander`'s help output so `devx --help` lists all 11 commands (`config` + 10 stubs) sorted by phase ascending. Each stub annotated `(coming in Phase N — epic-<slug>)`. `config` listed plain (it works).

## Acceptance criteria

- [ ] `devx --help` output lists all 11 commands sorted by phase ascending; ties broken alphabetically
- [ ] Each stub has `(coming in Phase N — epic-<slug>)` annotation
- [ ] `devx config` listed without "coming" annotation
- [ ] Snapshot test in `test/help.test.ts` catches accidental wording drift
- [ ] Snapshot updated atomically — every help-text change goes through the snapshot

## Technical notes

- Use `commander`'s custom help text hooks (`Command.helpInformation` override) or `--help` event hook.
- Build the listing dynamically from each command's `phase` + `epic` metadata fields (declared on each subcommand via a custom `.option()`-style decorator or stashed on `command.opts()`).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T19:50 — claimed by /devx; branch feat/dev-cli303 off main; single-branch YOLO (git.integration_branch: null → PR to main)
- 2026-04-26T19:57 — impl + self-review + local gates green: PhaseSortedHelp subclass + WeakMap-backed phase metadata; stub.ts + config.ts call attachPhase at register; cli.ts installs createHelp override after registration; test/help.test.ts has 5 tests (order, annotation, em-dash regression, config-no-coming, full inline snapshot); npm test 75/75 PASS
- 2026-04-26T19:58 — PR #10 opened against main. No remote CI workflow detected — local gates are authoritative. Proceeding to YOLO auto-merge.
- 2026-04-26T19:59 — merged via PR #10 (squash → fa48586). Worktree removed; feat/dev-cli303 branch deleted (local + remote).

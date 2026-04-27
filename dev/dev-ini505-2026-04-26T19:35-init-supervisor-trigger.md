---
hash: ini505
type: dev
created: 2026-04-26T19:35:00-07:00
title: Supervisor installer trigger + verify
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx
blocked_by: [ini502, sup405]
branch: feat/dev-ini505
---

## Goal

Wire `/devx-init` to call `installSupervisor()` and `verifySupervisor()` from epic-os-supervisor-scaffold for both `manager` and `concierge` roles. Auto-detect platform; honor explicit `manager.os_supervisor` config override. Include WSL host-vs-WSL PATH detection from cli305.

## Acceptance criteria

- [ ] Calls `installSupervisor('manager')` and `installSupervisor('concierge')` from `src/lib/supervisor.ts`
- [ ] Reads `manager.os_supervisor` from the just-written `devx.config.yaml`; `auto` resolves via `uname` → `launchd | systemd | task-scheduler`
- [ ] Post-install: calls `verifySupervisor()` for both; on success appends checkmark to "setting up now…" checklist; on failure files MANUAL.md entry but does NOT abort init
- [ ] WSL detection (cli305): warns if `npm config get prefix` is on `/mnt/c/`; surfaces as MANUAL.md entry (not init failure)
- [ ] Vitest covers: macOS detection / Linux detection / WSL detection / explicit `none` skip / verification failure → MANUAL.md not abort

## Technical notes

- Verification failure ≠ install failure — units may be installed but not yet started; init should still complete.
- Stub script must already exist at `~/.devx/bin/devx-supervisor-stub.sh` before unit install (sup401 prerequisite).

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-27T14:35 — claimed by /devx; branch feat/dev-ini505 (single-branch YOLO; develop/dev-ini505 in frontmatter was stale plan-time default)
- 2026-04-27T14:55 — implemented src/lib/init-supervisor.ts (runInitSupervisor composes installSupervisor + verifySupervisor for manager+concierge; pins resolved platform to skip per-call YAML re-reads; WSL host-crossover MANUAL.md filing per cli305); 8 new tests in test/init-supervisor.test.ts; 345/345 tests passing locally.
- 2026-04-27T15:00 — merged via PR #26 (squash → 54f8443); DEV.md flipped [x]; worktree removed.

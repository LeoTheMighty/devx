---
hash: dvx105
type: dev
created: 2026-04-28T19:30:00-07:00
title: Three-state remote-CI probe + ScheduleWakeup polling
from: _bmad-output/planning-artifacts/epic-devx-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: ready
blocked_by: [dvx101]
branch: feat/dev-dvx105
---

## Goal

Ship `src/lib/devx/await-remote-ci.ts → awaitRemoteCi(branch)` as a three-state probe: no-workflow / workflow-no-run / completed. Use `ScheduleWakeup` 120s delays for cache-warm polling.

## Acceptance criteria

- [ ] `src/lib/devx/await-remote-ci.ts` exports `awaitRemoteCi(branch)` returning one of:
  - `{state:"no-workflow"}` — `.github/workflows/` missing or empty.
  - `{state:"workflow-no-run"}` — workflows present but `gh run list --branch <branch>` returns nothing within 60s + one ScheduleWakeup retry.
  - `{state:"completed", conclusion:"success" | "failure" | "cancelled" | ...}` — runs returned + completed.
- [ ] Polling implemented via `ScheduleWakeup` 120s delay (cache-warm window per harness rules).
- [ ] `headSha` verified against `git rev-parse HEAD` — mismatch returns `{state:"workflow-no-run"}`.
- [ ] `.claude/commands/devx.md` Phase 7 invokes the helper; on `"workflow-no-run"`, files INTERVIEW.md entry + marks PR `awaiting-approval` + stops.
- [ ] Tests cover all 3 states with mocked `gh run list` outputs.

## Technical notes

- Cache-warm polling at 120s is critical for cost — see harness rules on prompt cache TTL (5 min).

## Status log

- 2026-04-28T19:30 — created by /devx-plan

---
hash: ini506
type: dev
created: 2026-04-26T19:35:00-07:00
title: Failure-mode handling (BMAD-fail / gh-not-auth / no-remote)
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [ini503, ini505]
branch: develop/dev-ini506
---

## Goal

Implement `src/lib/init-failure.ts` covering the three Phase 0 failure modes. Adds the `init.partial:true` flag, the pending-gh-ops queue, MANUAL.md entries, and the `devx init --resume-gh` subcommand for replaying deferred work.

## Acceptance criteria

- [ ] `init-failure.ts` writes `init.partial: true` flag to `devx.config.yaml` whenever any deferred work exists
- [ ] **BMAD-install failure:** capture exit code + stderr; offer `[r]etry / [s]kip / [a]bort`; skip writes `bmad.modules: []` + 1 MANUAL.md entry
- [ ] **`gh` not authenticated:** detected via `gh auth status` exit 1; queue branch-protection + develop-push + workflow-push to `.devx-cache/pending-gh-ops.json`; 1 MANUAL.md entry
- [ ] **No remote:** skip all `gh` ops; promotion gate forced to `manual-only` regardless of mode; 1 MANUAL.md entry
- [ ] `devx init --resume-gh` (registered as `src/commands/init.ts` — the 12th non-stubbed command): reads `.devx-cache/pending-gh-ops.json`, replays each op, clears `init.partial` if all succeed
- [ ] `init.partial:true` blocks `/devx-plan`, `/devx`, etc. in modes ≥ BETA via a refuse-to-spawn check
- [ ] Vitest covers all three failure modes against fixture repos
- [ ] `devx init --resume-gh` test: corrupt pending-gh-ops.json → abort with clear error; partial replay (one op fails) → keep flag, log which ops succeeded

## Technical notes

- Flag-blocking check is a one-liner all dev commands import: `assertNotPartial()` reads `init.partial` and throws if true + mode ≥ BETA.
- Pending-gh-ops queue is YAML, not JSON, for hand-edit visibility (per Leonid voice).

## Status log

- 2026-04-26T19:35 — created by /devx-plan

---
hash: d02000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 9 — Modes & full gate cascade"
status: deferred
from: docs/ROADMAP.md#phase-9--modes--full-gate-cascade-week-89
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend, infra]
blocked_by: [b02000]
---

## Goal

Every gate respects mode × shape × thoroughness; LOCKDOWN works end-to-end; trust-gradient autonomy ladder is wired.

## Scope

Six epics from [`ROADMAP.md § Phase 9`](../docs/ROADMAP.md#phase-9--modes--full-gate-cascade-week-89):

- `epic-devx-mode-skill` — `/devx-mode` show/set/dry-run/resume; downgrade-out-of-PROD friction.
- `epic-promotion-gate-prod` — careful promotion mode (CI + soak + QA + panel).
- `epic-promotion-gate-lockdown` — manual-only with decision record.
- `epic-mode-gated-mobile-perms` — mobile companion enforces `MODES.md §2.10` permission matrix.
- `epic-mode-shape-validation` — `/devx-init` blocks nonsensical combos (empty-dream+PROD, production-careful+YOLO).
- `epic-trust-gradient-autonomy` — `promotion.autonomy.{initial_n, rollback_penalty, hotfix_zeroes, veto_window_hours}` wired into PromotionAgent; `devx autonomy --freeze/--off` CLI.

Cross-references [`MODES.md`](../docs/MODES.md).

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed.

## Acceptance criteria

- [ ] PROD-mode promotion requires CI + 24h soak + QA pass + panel-clear; blocks when any fails.
- [ ] LOCKDOWN refuses any automated promotion; `/devx-promote --force` requires decision record.
- [ ] Trust ladder unlocks auto-promote after `initial_n` greens, halves on revert, zeros on hotfix.

## Status log

- 2026-04-26T19:30 — Phase 9 placeholder created

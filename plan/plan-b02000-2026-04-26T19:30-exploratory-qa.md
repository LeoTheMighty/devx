---
hash: b02000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 7 — Exploratory QA: browser-use subprocesses"
status: deferred
from: docs/ROADMAP.md#phase-7--exploratory-qa-week-78
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend, infra]
blocked_by: [e01000, a02000]
---

## Goal

Browser-use subprocesses find UX pain before users do. Manager spawns them on TestAgent / FocusAgent demand against PR preview deploys, seeded with persona prompts.

## Scope

Five epics from [`ROADMAP.md § Phase 7`](../docs/ROADMAP.md#phase-7--exploratory-qa-week-78):

- `epic-preview-deploys` — `/devx-init` wires Cloudflare Pages or Vercel preview per PR; URL detected in CI.
- `epic-browser-use-runner` — `qa/qa-<hash>-*.md` spec → Manager spawns Playwright subprocess → JSON output → FOCUS.md/DEBUG.md filing.
- `epic-story-derived-qa` — `/devx` Phase 6 auto-files `test/test-*-qa-walkthrough.md`.
- `epic-qa-cost-cap` — Worker-side daily $-cap per mode; refuse scheduled runs past cap.
- `epic-persona-seeded-qa` — wire `focus-group/personas/*.md` directly into browser-use prompts.

Cross-references [`QA.md`](../docs/QA.md) for the two-layer QA design.

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed.

## Acceptance criteria

- [ ] Every PR to `develop` has a preview-deploy URL in its body.
- [ ] Browser-use subprocess runs against a preview, files at least one real-looking FOCUS.md insight on dogfood.
- [ ] QA cost cap blocks a scheduled run when budget exceeded; surfaces MANUAL escalation.

## Status log

- 2026-04-26T19:30 — Phase 7 placeholder created

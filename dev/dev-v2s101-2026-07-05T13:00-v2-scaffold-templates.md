---
hash: v2s101
type: dev
created: 2026-07-05T13:00:00-06:00
title: V2.0-b/c — engine template scaffold + backlog wiring
from: v2/06-phases.md
plan: v2/
status: in-progress
owner: /devx-2026-07-05T0958-23724
blocked_by: []
branch: feat/dev-v2s101
---

## Goal

Scaffold the v2 engine's filesystem surface (templates + workstreams root) and
wire the v2 plan into the live backlogs, per `v2/06-phases.md § V2.0`.

## Acceptance criteria

- [ ] `_devx/templates/engine/` exists with 9 templates: `prd.md`,
      `expectations.md`, `design.md`, `plan.md`, `decision.md`,
      `red-report.md`, `checkpoint.md`, `lessons-entry.md`, `results.md` —
      shapes per `v2/02-engine.md` §4; every template JIRA/Confluence-free.
- [ ] `expectations.md` template carries the exact E-block shape (Priority /
      Covers / Trigger / EARS / Threshold / Verified by).
- [ ] `decision.md`, `red-report.md`, `checkpoint.md`, `results.md` templates
      open with the deterministic verdict block (D-9 vocabulary).
- [ ] `_devx/workstreams/.gitkeep` exists; `devx.config.yaml` untouched (the
      `engine:` block ships in v2x101 with its schema).
- [ ] `_bmad-output/planning-artifacts/README-FROZEN.md` freeze note added
      (read-only history; nothing writes here after mgrret).
- [ ] A grep-based test asserts no template contains
      `jira|confluence|atlassian` (case-insensitive) — the D-10 enforcement
      seed.
- [ ] Tests green.

## Technical notes

- Templates are content-only; no code consumes them until v2e101. Keep them
  byte-faithful to `v2/02-engine.md` so gate validators can pin against them.

## Status log

- 2026-07-05T13:00 — created from v2/06-phases.md § V2.0 (v2 bootstrap).
- 2026-07-05T09:58:42-06:00 — claimed by /devx in session /devx-2026-07-05T0958-23724

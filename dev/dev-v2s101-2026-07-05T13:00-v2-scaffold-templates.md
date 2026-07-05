---
hash: v2s101
type: dev
created: 2026-07-05T13:00:00-06:00
title: V2.0-b/c — engine template scaffold + backlog wiring
from: v2/06-phases.md
plan: v2/
status: done
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
- 2026-07-05T13:20 — implemented: 9 engine templates (_devx/templates/engine/), _devx/workstreams/ root, _bmad-output freeze note, D-10 grep test (test/engine-templates.test.ts). Self-review: 2 findings (verdict-block regex anchored per-template not per-file; results.md uses outcome: not gate: vocabulary — test adjusted to match D-9's results shape), both fixed.
- 2026-07-05T13:30 — PR https://github.com/LeoTheMighty/devx/pull/59 merged (9dd187d); worktree removed; lock released.
- 2026-07-05T10:15 — phase 4: self-review — 2 findings, all fixed (retroactive discipline line appended in roc101 PR #60: the 13:20 'implemented:' entry above carried the self-review findings but lacked the mandatory literal 'phase 4:' prefix, which turned the status-log discipline gate red on main for every PR)

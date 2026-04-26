# Epics Index

## Addendum — 2026-04-23 — Mobile companion v0.1 through real-time sync

Four epics, ship in dependency order. Each is a user-visible milestone.

| # | Slug | User sees | Layers touched |
|---|---|---|---|
| 1 | `epic-flutter-scaffold-ios-device` | "My empty devx app is running on my iPhone." | frontend + infra |
| 2 | `epic-github-connection-read` | "I can see all my devx backlogs on my phone." | frontend |
| 3 | `epic-bidirectional-writes-offline` | "I can add /dev items and answer questions from my phone — even without signal." | frontend |
| 4 | `epic-realtime-updates-push` | "My phone buzzes the instant an agent needs me; my laptop picks up phone-added items within seconds." | frontend + backend + infra |

Dependencies: strict linear (1 → 2 → 3 → 4). Epic 2 requires Epic 1's on-device build path; Epic 3 requires Epic 2's auth + client; Epic 4 requires Epic 3's write pipeline as the signal source.

## Addendum — 2026-04-26 — Phase 0 Foundation (devx itself)

Five epics, derived from [`docs/ROADMAP.md § Phase 0`](../../docs/ROADMAP.md#phase-0--foundation-week-1) and [`plan/plan-a01000-2026-04-26T19:30-foundation.md`](../../plan/plan-a01000-2026-04-26T19:30-foundation.md). Plan mode: YOLO, project_shape: empty-dream, thoroughness: balanced.

| # | Slug | User sees | Layers touched |
|---|---|---|---|
| 1 | `epic-bmad-audit` | "I can open `bmad-audit.md` and see which BMAD workflows devx invokes, wraps, escape-hatches, shadows, or leaves orphaned — and the risks." | None — documentation only |
| 2 | `epic-config-schema` | "I can read and write any of the 15 sections of `devx.config.yaml` from the terminal — including hand-edited values — without losing comments or ordering." | frontend (CLI) |
| 3 | `epic-cli-skeleton` | "Every `devx <subcmd>` either works (`devx config`) or tells me which phase + epic ships it (everyone else). `devx --help` surfaces the whole shape." | frontend (CLI) |
| 4 | `epic-os-supervisor-scaffold` | "After `/devx-init`, my OS confirms two devx units (`dev.devx.manager`, `dev.devx.concierge`) are loaded and would auto-restart — even though neither does anything yet." | infra |
| 5 | `epic-init-skill` | "I run `/devx-init` once and walk through ≤13 questions. ≤5 minutes later my repo is on the devx rails — backlog files, config, supervisor units, branch protection, CI workflow, personas — all without a single half-bricked surface." | frontend (CLI) + infra |

### Dependencies

```
epic-bmad-audit  ──┐                         (independent — landable first)
                   │
epic-config-schema ┴──┐                      (defines schema for CLI + init)
                      │
epic-cli-skeleton ────┴──┐                   (defines `devx` binary; uses schema)
                         │
epic-os-supervisor-scaffold ─┐               (uses devx binary in unit ExecStart)
                             │
epic-init-skill ─────────────┘               (orchestrates all the above)
```

**Recommended execution order** (matching dependency chain): `epic-bmad-audit` → `epic-config-schema` → `epic-cli-skeleton` → `epic-os-supervisor-scaffold` → `epic-init-skill`.

**Parallel-safe pairs:** `epic-bmad-audit` ∥ `epic-config-schema` (audit is research, config-schema is code — no shared surface). `epic-cli-skeleton` ∥ `epic-os-supervisor-scaffold` after config-schema lands (both depend on `devx` binary existing but don't depend on each other once the entrypoint is in place).

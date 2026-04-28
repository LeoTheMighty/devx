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

## Addendum — 2026-04-28 — Phase 1 Single-agent core loop (devx itself)

Five epics, derived from [`docs/ROADMAP.md § Phase 1`](../../docs/ROADMAP.md#phase-1--single-agent-core-loop-week-2) and [`plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`](../../plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md). Plan mode: YOLO, project_shape: empty-dream, thoroughness: balanced. Stack layers: backend + infra (no frontend layer this phase).

| # | Slug | User sees | Layers touched |
|---|---|---|---|
| 1 | `epic-merge-gate-modes` | "Mode-derived merge gate is one function call. Same primitive consumed by `/devx`'s feature→main merge (single-branch) and the latent `/devx-manage` develop→main promotion (split-branch). Single source of truth." | backend |
| 2 | `epic-pr-template` | "Every agent PR opens with the spec-file link as the first line and `Mode: <mode>` stamped at PR-open time. Reviewers know which gate auto-merge is applying." | infra |
| 3 | `epic-devx-plan-skill` | "`/devx-plan` runs the seven-phase loop end-to-end with branch-derivation, retro-row co-emission, source-of-truth-precedence enforcement, and a structurally explicit Phase 6.5 mode gate. The next plan I run produces ready-to-claim work with zero hand-edits." | backend |
| 4 | `epic-devx-skill` | "`/devx` runs the nine-phase loop end-to-end with claim-push-before-PR, conditional `bmad-create-story` (canary), adversarial self-review status-log discipline, mode-derived coverage gate, three-state remote-CI probe, and mode-gated auto-merge via the unified primitive. The 5 LEARN.md cross-epic patterns from Phase 0 don't regress." | backend |
| 5 | `epic-devx-manage-minimal` | "`/devx-manage` v0 runs as a thin scheduler+supervisor under the OS supervisor unit. It picks one ready DEV.md item, spawns one `claude /devx <hash>` subprocess (hard cap N=1), restarts on plain crash, persists state to `.devx-cache/state/`. The closed loop runs without me invoking `/devx`." | backend + infra |

### Dependencies

```
epic-merge-gate-modes ──┐                       (independent — landable first)
                        │
epic-pr-template ───────┤                       (independent — landable first; epic-init-skill already shipped)
                        │
epic-devx-plan-skill ───┤                       (independent of other Phase 1 peers)
                        │
                        ▼
                 epic-devx-skill                (consumes mrg102 CLI passthrough + prt102 template substitution)
                        │
                        ▼
            epic-devx-manage-minimal            (spawns claude /devx <hash> — needs Phase 1 /devx stable)
```

**Recommended execution order:** `epic-merge-gate-modes` ∥ `epic-pr-template` ∥ `epic-devx-plan-skill` (parallel-safe; pick top of DEV.md when starting) → `epic-devx-skill` (after mrg + prt land) → `epic-devx-manage-minimal` (after dvx ships).

**Parallel-safe pairs:** mrg ∥ prt ∥ pln (no shared files). Within each epic, stories follow the blocked-by graph in DEV.md / sprint-status.yaml.

**Story count:** 24 parent stories + 5 retro stories = 29 specs total. Comparable to Phase 0's 25.

---
hash: e01000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Phase 4 — Observability surfaces: TUI, web dashboard, mobile relay"
status: deferred
from: docs/ROADMAP.md#phase-4--observability-surfaces-week-45-parallel-with-phase-5
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [frontend, backend, infra]
blocked_by: [c4f1a2]
---

## Goal

Three views over Manager's event stream — TUI (`devx ui`), local web dashboard (`devx serve`), mobile Activity tab. Same `.devx-cache/events/*.jsonl` substrate, three lenses.

## Scope

Five epics from [`ROADMAP.md § Phase 4`](../docs/ROADMAP.md#phase-4--observability-surfaces-week-45-parallel-with-phase-5):

- `epic-devx-ui-tui` — Ink/Bubbletea three-pane TUI; vim keybinds; color-by-phase.
- `epic-devx-serve-web` — `localhost:7321` SSE-streamed dashboard with diff + PR preview + drag-reorder + Concierge chat dock.
- `epic-mobile-event-relay` — Manager → Cloudflare Worker → FCM event-shape contract.
- `epic-mobile-roster-card` — Activity tab "Now" + swipe-to-kill + long-press-to-restart.
- `epic-notification-filters` — `notifications.events` silent/push/digest tags + quiet hours + daily digest.

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed. Architecture decisions to be locked: TUI library (Ink in Bun vs. Bubbletea in Go vs. ratatui in Rust); SSE vs. WebSocket for the web dashboard.

## Acceptance criteria

- [ ] `devx ui` renders three workers + manager + concierge + inboxes; `K` kills the selected worker; `R` restarts.
- [ ] `devx serve` shows the same data in browser; drag-reorder of `DEV.md` persists to disk and Manager picks up the new order.
- [ ] Mobile Activity tab shows live roster card per worker; swipe-to-kill writes back through the Worker.
- [ ] `notifications.events: { context_rot_detected: silent }` actually suppresses the FCM push.

## Status log

- 2026-04-26T19:30 — Phase 4 placeholder created

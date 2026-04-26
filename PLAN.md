# PLAN — Planning work in flight

Backlog of plan-spec files for `/devx-plan` (and human reviewers) to draw from. Each entry points at a `plan/plan-<hash>-<ts>-<slug>.md` file. The static dependency graph and locked decisions live in [`docs/ROADMAP.md`](./docs/ROADMAP.md); this file is the live state.

Conventions per [`docs/DESIGN.md § Checkbox conventions`](./docs/DESIGN.md#checkbox-conventions): `[ ]` ready · `[/]` in-progress · `[-]` blocked · `[x]` done · `~~strikethrough~~` deleted. Status field on each entry is the source of truth; checkbox is the glanceable mirror.

---

## Phase plans

Each maps to a phase in [`ROADMAP.md`](./docs/ROADMAP.md). Pick one off the top once its blockers clear; `/devx-plan` expands it into `dev/*.md` sub-specs that flow into `DEV.md`.

- [x] `plan/plan-a01000-2026-04-26T19:30-foundation.md` — Phase 0 — Foundation (`/devx-init`, config schema, OS supervisor scaffolds, CLI skeleton, BMAD audit). Status: planned (25 dev specs spawned across 5 epics; tracked in DEV.md § Phase 0). Blocked-by: —.
- [-] `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md` — Phase 1 — Single-agent core loop (`/devx-plan`, `/devx`, minimal `/devx-manage`). Status: deferred. Blocked-by: a01000.
- [ ] `plan/plan-c4f1a2-2026-04-26T19:00-control-plane.md` — Phase 2 — Full control plane (event stream, rot detection, restart-from-status-log, crash recovery, Concierge, watchdogs). Status: ready. Blocked-by: — *(strictly b01000, but bootstrap path is to start here per session 2026-04-26)*.
- [-] `plan/plan-d01000-2026-04-26T19:30-parallelism.md` — Phase 3 — Parallelism & coordination (locks, intents, capacity, permissions). Status: deferred. Blocked-by: c4f1a2.
- [-] `plan/plan-e01000-2026-04-26T19:30-observability-surfaces.md` — Phase 4 — Observability surfaces (TUI, web dashboard, mobile relay). Status: deferred. Blocked-by: c4f1a2. Parallel-with: f01000.
- [-] `plan/plan-f01000-2026-04-26T19:30-test-debug-learn.md` — Phase 5 — Test, debug, retro, learn. Status: deferred. Blocked-by: c4f1a2.
- [-] `plan/plan-a02000-2026-04-26T19:30-focus-group.md` — Phase 6 — Focus group (persistent persona panel). Status: deferred. Blocked-by: f01000.
- [-] `plan/plan-b02000-2026-04-26T19:30-exploratory-qa.md` — Phase 7 — Exploratory QA (browser-use subprocesses). Status: deferred. Blocked-by: e01000, a02000.
- [-] `plan/plan-d02000-2026-04-26T19:30-modes-and-gates.md` — Phase 9 — Modes & full gate cascade. Status: deferred. Blocked-by: b02000.
- [-] `plan/plan-e02000-2026-04-26T19:30-polish-and-dogfood.md` — Phase 10 — Polish + dogfood (continuous; final pass). Status: deferred. Blocked-by: d02000.

## Cross-cutting plans

Independent of phase sequencing — pick up once their named blockers clear.

- [-] `plan/plan-f02000-2026-04-26T19:30-thoroughness-axis.md` — Wire `thoroughness` (`send-it`/`balanced`/`thorough`) through every command. Status: deferred. Blocked-by: a01000.
- [-] `plan/plan-a03000-2026-04-26T19:30-realtime-live-activities.md` — Mobile v0.3.5: Cloudflare DO stream + iOS Live Activities + Android persistent notification. Status: deferred. Blocked-by: c4f1a2, 7a2d1f.

## Mobile (Phase 8 — runs parallel from Phase 2 onward)

- [/] `plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md` — Mobile companion v0.1 → real-time. Status: in-planning (epics + stories already emitted to DEV.md; mobile-v0.1 through mobile-v1.0 sub-roadmap inside the plan file).

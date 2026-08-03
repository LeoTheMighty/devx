# PLAN — Planning work in flight

Backlog of plan-spec files for `/devx-plan` (and human reviewers) to draw from. Each entry points at a `plan/plan-<hash>-<ts>-<slug>.md` file. The static dependency graph and locked decisions live in [`docs/ROADMAP.md`](./docs/ROADMAP.md); this file is the live state.

Conventions per [`docs/DESIGN.md § Checkbox conventions`](./docs/DESIGN.md#checkbox-conventions): `[ ]` ready · `[/]` in-progress · `[-]` blocked · `[x]` done · `~~strikethrough~~` deleted. Status field on each entry is the source of truth; checkbox is the glanceable mirror.

---

## Phase plans

Each maps to a phase in [`ROADMAP.md`](./docs/ROADMAP.md). Pick one off the top once its blockers clear; `/devx-plan` expands it into `dev/*.md` sub-specs that flow into `DEV.md`.

- [x] `plan/plan-a01000-2026-04-26T19:30-foundation.md` — Phase 0 — Foundation (`/devx-init`, config schema, OS supervisor scaffolds, CLI skeleton, BMAD audit). Status: planned (25 dev specs spawned across 5 epics; tracked in DEV.md § Phase 0). Blocked-by: —.
- [x] `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md` — Phase 1 — Single-agent core loop (`/devx-plan`, `/devx`, minimal `/devx-manage`). Status: done (closed 2026-07-05, 5/5 epics). Blocked-by: a01000.
- ~~`plan/plan-c4f1a2-2026-04-26T19:00-control-plane.md` — Phase 2 — Full control plane.~~ Status: superseded 2026-07-05 — scope absorbed by the v2 migration (`v2/04-overnight-loop.md` + `v2/05-dispatcher.md`; restart-from-status-log falls out of the iteration contract). Kept for audit.

## v2 — Native engine migration (2026-07-05)

- [x] `v2/` — BMAD → native engine, review tours, universal dispatcher, overnight loop. Status: done (closed 2026-07-05, PRs #59–#68 in one day; retro: `_devx/retros/v2-migration-2026-07-05.md`; outcome scored: v2x101 keep 3/3). Source of truth: `v2/06-phases.md`; decisions: `v2/07-decisions.md`.
- [-] `plan/plan-d01000-2026-04-26T19:30-parallelism.md` — Phase 3 — Parallelism & coordination (locks, intents, capacity, permissions). Status: deferred. Blocked-by: c4f1a2. Note 2026-07-14: capacity-management slice re-homed to c8e2d4 (vision-gap Track 2). Note 2026-07-28: locks/coordination slice re-homed to 20eb6f (multi-loop concurrency).
- [-] `plan/plan-e01000-2026-04-26T19:30-observability-surfaces.md` — Phase 4 — Observability surfaces (TUI, web dashboard, mobile relay). Status: deferred. Blocked-by: c4f1a2. Parallel-with: f01000. Note 2026-07-14: interim notification slice re-homed to e5a9c0 (vision-gap Track 3).
- [-] `plan/plan-f01000-2026-04-26T19:30-test-debug-learn.md` — Phase 5 — Test, debug, retro, learn. Status: deferred. Blocked-by: c4f1a2.
- [-] `plan/plan-a02000-2026-04-26T19:30-focus-group.md` — Phase 6 — Focus group (persistent persona panel). Status: deferred. Blocked-by: f01000.
- [-] `plan/plan-b02000-2026-04-26T19:30-exploratory-qa.md` — Phase 7 — Exploratory QA (browser-use subprocesses). Status: deferred. Blocked-by: e01000, a02000.
- [-] `plan/plan-d02000-2026-04-26T19:30-modes-and-gates.md` — Phase 9 — Modes & full gate cascade. Status: deferred. Blocked-by: b02000.
- [-] `plan/plan-e02000-2026-04-26T19:30-polish-and-dogfood.md` — Phase 10 — Polish + dogfood (continuous; final pass). Status: deferred. Blocked-by: d02000.

## Vision-gap tracks (2026-07-14 drift audit)

Owner-approved 2026-07-14 (plan `sparkling-bubbling-pie`): close the gap
between the built single-repo system and the owner's intended use — portable
install, overnight usage-window riding, blocker push, multi-repo fleet.
Ship order = list order; mobile backlog (below) pauses until f1d6b2 ships.

- [x] `plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md` — Track 1 — Portability & install (packaged skills, real `devx init` scaffold, S-5 on palateful). Status: planned (all 4 gates passed 2026-07-14; 5 dev specs pin101–pin105 + pinret emitted to DEV.md § Vision-gap tracks; stage: executing). Blocked-by: —.
- [/] `plan/plan-c8e2d4-2026-07-14T10:41-usage-window-governor.md` — Track 2 — Usage-window governor (`devx loop` pauses on subscription limit, resumes on reset; re-homes d01000's capacity slice + OPEN_QUESTIONS §3). Status: ready. Blocked-by: —.
- [ ] `plan/plan-e5a9c0-2026-07-14T10:42-blocker-push-interim.md` — Track 3 — Interim blocker push (GitHub blockers-issue @mention; retired by mobile relay). Status: ready. Blocked-by: —.
- [-] `plan/plan-f1d6b2-2026-07-14T10:43-fleet-layer.md` — Track 4 — Fleet layer (`~/.devx/projects.yaml`, `devx fleet loop`, aggregated report, `/devx-fleet`; supersedes ROADMAP:16 scope per INTERVIEW Q#10). Status: blocked. Blocked-by: b3f7a1, c8e2d4.

## Multi-loop concurrency (2026-07-28)

Owner-requested 2026-07-28: N concurrent scoped `devx loop`s on one repo,
error-proof even under overlapping scopes. Full race inventory (R1–R12) +
seeded two-layer design live in the plan spec.

- [x] `plan/plan-20eb6f-2026-07-28T08:34-multi-loop-concurrency.md` — Multi-loop concurrency: repo-global root/locking, backlog mutation lock, claim-contention handling, spec-lock lifecycle, loop instance registry + capacity admission, epic/workstream/`--items`/`--focus` scoping. Status: done (all 4 gates passed 2026-07-28; mlc101–mlc106 shipped via PRs #91/#93/#94/#96/#98/#100 — +8,388/−794 across 70 files, ~88 adversarial-review findings fixed in-place; retro 2026-07-29 → `_devx/workstreams/multi-loop-concurrency/RETRO-2026-07-29.md`; stage: done; outcome armed → 2026-08-31 on G-2, whose E-7 real night is still unrun — MANUAL MV-mlc.1). Blocked-by: —. Related: db36af (doctor), lpf101 (preflight), c8e2d4 (usage governor), f1d6b2 (fleet — orthogonal, composes on top).

## Mid-story split (2026-07-28)

Owner-requested 2026-07-28: replace the conversation-only Handoff Snippet
(devx.md Phase 9, dvx107) with split-the-story — remaining work files as a
follow-up dev spec (fresh hash, `from:` parent, `Blocked-by:` wiring) via a
CLI primitive shared by interactive `/devx` and the `devx loop` driver
(worker-requested + budget rail), so any fresh session claims the remainder
cold. Merge-first preferred, branch-handoff fallback. Kills the hfi102
abandoned-while-done class.

- [x] `plan/plan-e0a67e-2026-07-28T12:15-mid-story-split.md` — Mid-story split: split primitive + carried-forward context contract, loop split paths + `split` outcome, Handoff Snippet retirement + skills/docs sweep, state-hygiene invariants. Status: executing (all 4 gates passed 2026-07-28; RED artifacts observed right-reason; emitted mss101–mss104 + mssret to DEV.md). Blocked-by: —. Related: mlc103 (spec-lock lifecycle), db36af (doctor), lpf101 (preflight).

- [x] `plan/plan-620c74-2026-07-29T11:56-retro-listener.md` — Retro listener: auto-spawn `/devx-learn` from the friction nudge (port of `mycase/8am-harness` PR #36 — Stop/SessionEnd listener hook, serial `devx learn-watch` drainer with tmux/Terminal fork-spawn, wire-protocol pin, `/devx-init` hook distribution, five-outlet routing rework; phase-2 unattended retros out of scope). Status: executing (all 4 gates passed 2026-07-30; RED artifacts observed right-reason; emitted rtl101–rtl106 + rtlret to DEV.md). Blocked-by: —. Related: eac479 (harness fold-in — the nudge + /devx-learn this listens for).

- [x] `plan/plan-62bcd1-2026-08-02T09:00-story-graph.md` — Story Graph: auto-generated GRAPH.md (Mermaid DAG of all specs grouped by workstream/epic), edge-source union + tokenizer hardening, loop regeneration hooks, assisted backfill porting friend-finder-mesh + palateful. Status: in-progress (planning complete — gates prd PASS / design CONCERNS-resolved / plan PASS / evals PASS 2026-08-02; stage executing; emitted sgr101–sgr107 + sgrret to `DEV.md § Epic — story-graph`). Blocked-by: —. Related: db36af (doctor owns drift *fixing*; graph only warns).

## Cross-cutting plans

Independent of phase sequencing — pick up once their named blockers clear.

- [-] `plan/plan-f02000-2026-04-26T19:30-thoroughness-axis.md` — Wire `thoroughness` (`send-it`/`balanced`/`thorough`) through every command. Status: deferred. Blocked-by: a01000.
- [-] `plan/plan-a03000-2026-04-26T19:30-realtime-live-activities.md` — Mobile v0.3.5: Cloudflare DO stream + iOS Live Activities + Android persistent notification. Status: deferred. Blocked-by: c4f1a2, 7a2d1f.
- [x] `plan/plan-eac479-2026-07-24T09:57-harness-fold-in.md` — Harness fold-in: per-workstream `todo.md` working memory, `/devx-learn` self-learning skill, gate-verdict persistence (ported shapes from `mycase/8am-harness` PRs #20–#27; no Confluence/Jira/eval-manifests). Status: done (all 5 phases merged PRs #80–#86 by 2026-07-25; retro 2026-07-26 `RETRO-2026-07-26.md`; outcome armed, measure-by 2026-08-21). Blocked-by: —.

## Mobile (Phase 8 — runs parallel from Phase 2 onward)

- [/] `plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md` — Mobile companion v0.1 → real-time. Status: in-planning (frontmatter-aligned; epics + stories already emitted to DEV.md; mobile-v0.1 through mobile-v1.0 sub-roadmap inside the plan file).

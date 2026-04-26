# ROADMAP — Master execution plan

The phased buildout of devx: locked decisions, dependency graph, and what we won't build. PLAN.md is the live backlog of plan-spec files; this is the static reference each plan-spec quotes from.

> **Redesign 2026-04-26** — Control plane simplified to two agents: `ManageAgent` (scheduler + supervisor in one loop) and `ConciergeAgent` (user-facing front door). TriageAgent folded into Manager. [`CONFIG.md`](./CONFIG.md) created as the canonical knob list. Three-layer staying-alive (OS supervisor / mutual watchdog / cloud watchdog) and three observability surfaces (TUI / web / mobile) added. Doc tree reorganized: design docs under `docs/`, runtime backlogs (`DEV.md`, `PLAN.md`, `MANUAL.md`) at root.

---

## Locked decisions (cross-epic)

**Branching & process**
- Commit prefix `devx-mobile:` tags all phone-originated commits.
- Phone writes target `git.integration_branch` if set (typically `develop`),
  otherwise `main` directly. The develop/main split is recommended-not-required;
  `/devx-init` asks once and recommends the split for non-YOLO projects.
- Single-repo MVP; multi-project switcher deferred to v1.5.

**Mobile + realtime**
- Payload shape across push notifications: `{kind, summary, deep_link, repo, emitted_at}`.
- Badge count = unanswered INTERVIEW + unchecked MANUAL only.
- PAT MVP; GitHub App OAuth deferred to v0.4.
- FCM v1 HTTP API (not legacy).
- Cloudflare Worker uses `*.workers.dev` subdomain — no custom domain for v0.1.
- **Three-tier realtime architecture (locked 2026-04-25 PM):** commits = durable state; Cloudflare Durable Object + WebSocket = realtime stream; APNs/FCM = push notifications, split into critical (banner) and silent (Live Activity) tiers. See [`MOBILE.md § Realtime updates`](./MOBILE.md#realtime-updates--three-tier-architecture).
- **Live Activities ship at v0.3.5 (locked 2026-04-25 PM):** between push notifications (v0.3) and GitHub App OAuth (v0.4). 2 days of Flutter + 1 day of Worker DO.

**Policy axes**
- **Three orthogonal config axes (locked 2026-04-25 PM):** `mode` (risk to user data) × `project.shape` (state of codebase) × `thoroughness` (process depth / token budget). Each cascades independently to gates, autonomy, and ceremony.

**Architectural refuses (from competitive analysis 2026-04-25 PM)**
- No metered-SaaS billing layer ever. devx infra cost stays $0; users pay only their own LLM/GitHub bills. Adding ACU-style billing destroys the lock-in story.
- No proprietary state store; markdown + git stays the ground truth.
- BMAD remains a library, not a fork. `devx eject` must always work.

**Control plane (locked 2026-04-26)**
- `ManageAgent` = scheduler + supervisor in one loop. Reads backlogs, decides desired roster, spawns/restarts workers. Persists desired roster to `.devx-cache/state/schedule.json` so restart is recoverable from disk. Thin loop, narrow tools (filesystem + subprocess + heartbeat).
- `ConciergeAgent` = always-on user-facing front door. Routes inbound (CLI/mobile/scheduled) → backlog files; emits outbound notifications via Worker→FCM/webhook/email. Minimal context — router + notifier, never reasoner. Supervised by Manager.
- Workers are stateless restartable subprocesses. Spec-file status log + acceptance criteria carry the resume context — context rot triggers a fresh `claude /devx-<role> <slug>`, not a continuation snippet.
- OS-level supervision via launchd (mac) / systemd-user (linux) / Task Scheduler (win-WSL). Mutual watchdog between Manager and Concierge. Cloud watchdog GitHub Actions cron for laptop-asleep coverage.

---

## Phased buildout

Each phase is built on top of the previous one. No skipping, but parallelism within a phase is fine.

### Phase 0 — Foundation (week 1)

**Goal:** a `/devx-init` that sets up the rails on any repo (empty or existing) without yet running a closed loop. All scaffolding, no execution loop.

| Epic | Output | Notes |
|---|---|---|
| `epic-init-skill` | `/devx-init` 13-question conversation (see [`CONFIG.md` §What `/devx-init` actually asks](./CONFIG.md)), idempotent, branch protection, scaffold backlog files, `devx.config.yaml`, `.devx-cache/`, `.gitignore`, CLAUDE.md seed | Hardest UX in the system; do this first |
| `epic-config-schema` | `devx.config.yaml` JSON schema covering all 15 sections in [`CONFIG.md`](./CONFIG.md). `devx config <key>` get/set CLI | The single source of every knob |
| `epic-os-supervisor-scaffold` | `/devx-init` writes `~/Library/LaunchAgents/dev.devx.manager.plist` (mac), `~/.config/systemd/user/devx-manager.service` (linux), or Task Scheduler entry (win-WSL). Same for `dev.devx.concierge`. Both load on login, restart on crash | Layer 1 of staying-alive |
| `epic-cli-skeleton` | `devx ui`, `devx serve`, `devx tail`, `devx kill`, `devx restart`, `devx status`, `devx pause`, `devx resume`, `devx ask`, `devx config`, `devx eject` — stub each to print "not yet wired"; flesh out as later phases land | Ship the surface area early so users see the shape |
| `epic-bmad-audit` | Audit each BMAD workflow + skill; declare which devx invokes / wraps / passes-through (Q7) | Do this *before* writing /devx skills so we don't reinvent |

### Phase 1 — Single-agent core loop (week 2)

**Goal:** one worker at a time, full discipline, real PRs landing on `develop`. ManageAgent runs but spawns N=1.

| Epic | Output |
|---|---|
| `epic-devx-plan-skill` | `/devx-plan` — research → PRD → architecture → epics → party-mode → DEV.md entries |
| `epic-devx-skill` | `/devx` — claim DEV.md item, worktree, implement, test, push, wait CI, merge to develop |
| `epic-devx-manage-minimal` | `/devx-manage` v0: read backlogs, pick next runnable, spawn one worker subprocess at a time, write `.devx-cache/state/schedule.json` and `manager.json`. No restart-on-rot yet. Heartbeat to disk every 60s |
| `epic-pr-template` | `.github/pull_request_template.md` with spec-file link + mode stamp |
| `epic-promotion-gate-yolo-beta` | `develop → main` gate for YOLO + BETA modes only (CI-green-only and CI+no-blockers) |

### Phase 2 — Full control plane (week 3)

**Goal:** Manager and Concierge as resilient long-lived processes. Workers are restartable across context rot. Crash-recoverable from disk.

| Epic | Output |
|---|---|
| `epic-events-stream` | `.devx-cache/events/<agent-id>.jsonl` — append-only per-worker event log; emitted by every worker, consumed by Manager (rot detection), TUI, web, and mobile relay |
| `epic-context-rot-detection` | Manager watches event stream + token usage; restart-on-token-pct (default 0.85), max-worker-age (90 min), explicit "stopping" lines. Writes restart event to spec status log |
| `epic-restart-from-status-log` | Worker resume protocol: spawned `claude /devx-<role> <slug>` reads spec frontmatter + status log + acceptance criteria + branch state and continues. End-to-end test: kill mid-`/devx`, fresh worker finishes the same PR |
| `epic-crash-recovery` | Manager restart reads `schedule.json` + `manager.json` from disk, re-attaches live PIDs, respawns dead ones based on status-log freshness, marks orphaned otherwise |
| `epic-devx-concierge-skill` | `/devx-concierge` — long-running router. Inbound: `devx ask <q>`, mobile, scheduled prompts → routes to backlog. Outbound: subscribes to manager event stream, emits to FCM/webhook/email per `notifications.events` |
| `epic-mutual-watchdog` | Manager monitors Concierge PID + Concierge polls `heartbeat.json`. `devx-revive` cron (15 min) breaks both-wedged cycles |
| `epic-cloud-watchdog` | `.github/workflows/devx-cloud-watchdog.yml` — every 30 min polls Concierge status endpoint or tails `develop` activity; files MANUAL + FCM if idle with ready work |

### Phase 3 — Parallelism & coordination (week 4)

**Goal:** N=3 workers in parallel without rip-through. Race-tested.

| Epic | Output |
|---|---|
| `epic-locks` | `.devx-cache/locks/` — `manager.lock`, `concierge.lock`, `spec-<hash>.lock`, `ci-wait-<branch>.lock` (atomic O_EXCL create) |
| `epic-intents` | `.devx-cache/intents/<agent-id>.json` — Manager reads before spawn; conflicts surface as deferrals |
| `epic-rip-through-test` | Integration test that races two `/devx` against the same branch family; asserts second backs off (Q31) |
| `epic-capacity-management` | Priority tiers (Plan>Dev>Test/Debug>Focus>Learn) + ScheduleWakeup-on-reset (Q3); enforce `capacity.max_concurrent` + `capacity.usage_cap_pct` + `capacity.daily_spend_cap_usd` |
| `epic-permission-enforcement` | Wire `permissions.bash.{allow,ask,deny}` into worker spawn so agents inherit the policy from `devx.config.yaml`; `.env` / SSH keys hard-denied regardless of config |

### Phase 4 — Observability surfaces (week 4–5, parallel with Phase 5)

**Goal:** three views over the event stream — TUI, web dashboard, mobile feed.

| Epic | Output |
|---|---|
| `epic-devx-ui-tui` | `devx ui` — Ink/Bubbletea-class three-pane terminal dashboard (sidebar: roster + system + inboxes; detail: phase, tokens, branch, status log, live tail; status bar: keybinds). Vim keybinds, color-by-phase. Reads `.devx-cache/` direct |
| `epic-devx-serve-web` | `devx serve` — `localhost:7321` SSE-streamed web dashboard. Same layout + diff viewer + PR preview + drag-to-reorder backlogs + Concierge chat dock |
| `epic-mobile-event-relay` | Manager transforms raw worker jsonl → high-level transitions → Cloudflare Worker → FCM. Mobile Activity tab consumes `agent_started` / `phase_changed` / `context_rot_detected` / `restarted` / `manual_filed` / `ci_failed` / `pr_opened` / `pr_merged` / `promotion_ready` events |
| `epic-mobile-roster-card` | Activity tab "Now" section: roster card per active worker (name, phase, age, % ctx). Pull-to-refresh; swipe-to-kill; long-press-to-restart |
| `epic-notification-filters` | `notifications.events` config wired end-to-end (silent / push / digest tags); quiet hours; daily digest schedule |

### Phase 5 — Test, debug, retro, learn (week 5–6)

**Goal:** the system writes its own tests, fixes its own bugs, and learns from both.

| Epic | Output |
|---|---|
| `epic-devx-test-layer-1` | `/devx-test` Phase 1 — Playwright regression authoring, line-level touched-surface coverage gate |
| `epic-devx-debug-skill` | `/devx-debug` — read DEBUG.md, repro from logs, fix, regression test |
| `epic-flaky-detection` | Auto-flag tests that green-then-red-then-green within 24h; write to TEST.md |
| `epic-retro-agent` | RetroAgent runs at end of every `/devx` and `/devx-plan`; writes `retros/retro-<spec-hash>.md` |
| `epic-learn-agent` | LearnAgent ≥3 concordant retros → LESSONS.md proposal with mode-derived auto-apply ceiling |
| `epic-canary-prompt-changes` | Skill/prompt edits run via 3-shadow-PR comparison before merge (SELF_HEALING.md §Canary) |
| `epic-over-tuning-detector` | LearnAgent compares user skill edits vs lesson applications; surfaces warning to MANUAL.md |

### Phase 6 — Focus group (week 6–7)

**Goal:** persistent persona panel consulted at every meaningful change.

| Epic | Output |
|---|---|
| `epic-focus-group-init` | `/devx-init` Q5 expands archetypes into 4–6 full personas + mandatory anti-persona; writes `focus-group/personas/` |
| `epic-focus-group-pre-plan` | After party-mode in `/devx-plan`, run new-feature-reaction prompt; results to focus-group/sessions/ |
| `epic-focus-group-pre-promotion` | At promotion gate, run pre-merge-ux-check prompt; mode-derived block thresholds |
| `epic-devx-focus-group-skill` | `/devx-focus-group` direct invocation, with `--persona` flag |
| `epic-persona-evolution` | LearnAgent reads telemetry vs panel predictions; weekly digest of reaction-library updates (Q24) |

### Phase 7 — Exploratory QA (week 7–8)

**Goal:** browser-use subprocesses find UX pain before users do. Spawned by Manager on TestAgent / FocusAgent demand.

| Epic | Output |
|---|---|
| `epic-preview-deploys` | `/devx-init` wires Cloudflare Pages or Vercel preview per PR; URL detected in CI |
| `epic-browser-use-runner` | `qa/qa-<hash>-*.md` spec → Manager spawns Playwright subprocess → JSON output → FOCUS.md/DEBUG.md filing |
| `epic-story-derived-qa` | `/devx` Phase 6 auto-files `test/test-*-qa-walkthrough.md`; TestAgent prefers them; FocusAgent ingests as persona prompts |
| `epic-qa-cost-cap` | Worker-side daily $-cap per mode; refuse scheduled runs past cap |
| `epic-persona-seeded-qa` | Wire `focus-group/personas/*.md` directly into browser-use prompts (Q25) |

### Phase 8 — Mobile companion (parallel from week 4)

The MOBILE.md plan stands; this is its position in the master sequence.

| Phase | Scope | Effort |
|---|---|---|
| `mobile-v0.1` | Read backlogs + inbox, answer INTERVIEW, add `/dev`, PAT auth, poll-only | ~1 week |
| `mobile-v0.2` | Offline queue (drift) | +1 day |
| `mobile-v0.3` | Push notifications via Worker + FCM (high-priority tier) | +3 days |
| **`mobile-v0.3.5`** | **Live Activities + Durable Object event stream (Tier 2 + Tier 3 silent). ManageAgent publishes high-level transitions to the DO; iOS/Android live surfaces consume. The Replit-pattern steal.** | +2 days |
| `mobile-v0.4` | GitHub App OAuth (replaces PAT) | +2 days |
| `mobile-v0.5` | Attachments (photo, voice note) committed as blobs | +2 days |
| `mobile-v0.6` | Spec-detail "add comment" appends to status log | +1 day |
| `mobile-v0.7` | macOS menu-bar widget (Flutter desktop) | +3 days |
| `mobile-v1.0` | Linux/Windows full platform parity | +1 week |

### Phase 9 — Modes & full gate cascade (week 8–9)

**Goal:** every gate respects mode × shape × thoroughness; LOCKDOWN works end-to-end.

| Epic | Output |
|---|---|
| `epic-devx-mode-skill` | `/devx-mode` show/set/dry-run/resume; downgrade-out-of-PROD friction |
| `epic-promotion-gate-prod` | Careful promotion mode (CI + soak + QA + panel) |
| `epic-promotion-gate-lockdown` | Manual-only, decision record |
| `epic-mode-gated-mobile-perms` | Mobile companion enforces MODES.md §2.10 permission matrix |
| `epic-mode-shape-validation` | `/devx-init` blocks nonsensical combos: empty-dream+PROD, production-careful+YOLO (Q32) |
| `epic-trust-gradient-autonomy` | `promotion.autonomy.{initial_n, rollback_penalty, hotfix_zeroes, veto_window_hours}` wired into PromotionAgent; `devx autonomy --freeze/--off` CLI |

### Phase 10 — Polish + dogfood (week 9+)

| Epic | Output |
|---|---|
| `epic-empty-state-copy` | First-impression copy for every backlog file, INTERVIEW-empty, MANUAL-empty |
| `epic-stuck-agent-detection` | Worker unchanged for >2h or `max_restarts_per_spec` exceeded → MANUAL.md escalation |
| `epic-claude-md-compaction` | LearnAgent quarterly compact pass when CLAUDE.md > 1000 lines (Q17) |
| `epic-monorepo-config` | `devx.config.yaml → projects:` per-subtree commands (Q12, Q20) |
| `epic-eject-cli` | `devx eject` removes all devx-specific state, leaves vanilla BMAD project |
| `epic-public-readme-pass` | Final README polish; honest-ROI numbers calibrated against real dogfood data |

---

## Sequencing notes

- **Phase 8 (mobile) can run in parallel with Phases 4–7** — it has its own Flutter codebase and only touches the read/write contract on the backlog files + ManageAgent's event-relay endpoint, both frozen by Phase 2.
- **Phase 4 (observability) can run in parallel with Phase 5** — it's purely a consumer of the event stream that Phase 2 produces.
- **Phase 9 cannot start until Phase 7** — the full PROD gate requires QA Layer 2 to exist.
- **Phase 10 is mostly continuous** — empty-state copy and dogfood polish should accrue throughout, not be deferred.
- **Critical path to "I can leave it running overnight"**: Phase 0 → 1 → 2 (control plane + crash recovery) → 3 (parallelism + permissions) → 5 (RetroAgent + LearnAgent) → 9 (full gates). Phase 4 (observability) lights up the *experience* but isn't load-bearing for autonomy.
- **First dogfood-able milestone**: end of Phase 2. Manager + Concierge running on Leonid's laptop, single-agent loop building devx itself, restarts surviving context rot.

---

## What to defer past v1.0

Per product-brief anti-scope:
- Hosted SaaS / "devx Cloud."
- Multi-repo / cross-repo coordination beyond a monorepo's per-subtree map.
- Plugin system for third-party agents.
- Any user accounts, auth server, or billing infra.

---

## Planning artifact index

Existing BMAD outputs (referenced from plan-spec files via `from:` and `spawned:` chains):

- `_bmad-output/planning-artifacts/product-brief.md` — the founding product brief.
- `_bmad-output/planning-artifacts/prd.md` — v0.1 mobile-companion PRD.
- `_bmad-output/planning-artifacts/epics.md` — running index of epic slugs and "user sees" summaries.
- `_bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md`
- `_bmad-output/planning-artifacts/epic-github-connection-read.md`
- `_bmad-output/planning-artifacts/epic-bidirectional-writes-offline.md`
- `_bmad-output/planning-artifacts/epic-realtime-updates-push.md`

Companion docs:
- [`COMPETITION.md`](./COMPETITION.md) — competitive analysis 2026-04-25 PM. Drives the "steal Live Activities, refuse metered SaaS" decisions.
- [`DESIGN.md`](./DESIGN.md) — full system shape: backlog graph, control plane, staying-alive, observability surfaces.
- [`CONFIG.md`](./CONFIG.md) — every configurable knob, what `/devx-init` asks vs. defaults.
- [`MOBILE.md`](./MOBILE.md), [`MODES.md`](./MODES.md), [`QA.md`](./QA.md), [`SELF_HEALING.md`](./SELF_HEALING.md), [`FOCUS_GROUP.md`](./FOCUS_GROUP.md) — subsystem contracts.

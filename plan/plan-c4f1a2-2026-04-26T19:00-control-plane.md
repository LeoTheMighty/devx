---
hash: c4f1a2
type: plan
created: 2026-04-26T19:00:00-07:00
title: Control plane (ManageAgent + ConciergeAgent)
status: ready
from: PLAN.md § Phase 2
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend, infra]
---

## Goal

Build the long-running control plane: `ManageAgent` (scheduler + supervisor in one loop) and `ConciergeAgent` (always-on user-facing front door). End state — Leonid can leave his laptop running overnight, workers progress through `DEV.md` without intervention, context-rotted workers restart from spec status logs, and the phone surfaces only events that need a human.

This plan is the execution chunking for **Phase 2** of [`PLAN.md`](../PLAN.md). It assumes Phase 0 (init/config/OS-supervisor scaffolds) and Phase 1 (single-agent loop) are complete.

## In scope

Seven epics from PLAN.md Phase 2:

1. `epic-events-stream` — `.devx-cache/events/<agent-id>.jsonl` produce + consume contract
2. `epic-context-rot-detection` — Manager rot detector (token-pct + max-age + explicit signals)
3. `epic-restart-from-status-log` — worker resume protocol; spec status log carries the context
4. `epic-crash-recovery` — Manager rebuilds from `schedule.json` + `manager.json` on restart
5. `epic-devx-concierge-skill` — `/devx-concierge` long-running router + notifier
6. `epic-mutual-watchdog` — Manager↔Concierge cross-monitoring + `devx-revive` cron
7. `epic-cloud-watchdog` — `.github/workflows/devx-cloud-watchdog.yml` for laptop-asleep coverage

## Out of scope

- Parallelism (Phase 3 — locks, intents, capacity caps).
- Browser-QA subprocess spawning (Phase 7).
- Self-healing loop (Phase 5).
- Observability surfaces (Phase 4) — this plan emits events; Phase 4 builds the UIs that consume them.
- Promotion gate beyond YOLO/BETA (Phase 9).

## Acceptance criteria

End-to-end, demonstrable on Leonid's laptop:

- [ ] **Manager process is supervised by launchd** (mac) and survives `kill -9 <pid>` — auto-respawns within 10s.
- [ ] **Concierge process is supervised by launchd** under the same contract.
- [ ] **`/devx` with no args** picks the top runnable item from `DEV.md`, claims it (`[ ]` → `[/]`), and proceeds. (See [§Checkbox conventions](#checkbox-conventions) below.)
- [ ] **Context-rot restart works under simulated load**: a `/devx` worker artificially nudged to 90% token usage is killed by Manager, a fresh worker spawns against the same spec, reads the status log, and finishes the PR. Status log shows the restart event.
- [ ] **Manager crash recovery works**: `kill -9` Manager mid-tick; on respawn, it re-attaches to live worker PIDs and re-decides on dead ones using status-log freshness.
- [ ] **`devx ask "<question>"`** routes to the correct backlog (feature-request → `DEV.md`, bug → `DEBUG.md`, question to agent → `INTERVIEW.md`).
- [ ] **FCM push fires** on `manual_filed`, `interview_filed`, `ci_failed`, `pr_merged`, `context_rot_detected` (the last one suppressible per `notifications.events`).
- [ ] **Mutual watchdog test**: kill Manager, leave Concierge alive. Within 5 min, Concierge respawns Manager. Vice versa for Concierge.
- [ ] **Cloud watchdog fires**: simulate laptop-asleep (stop both processes); within 30 min the GitHub Actions cron files a MANUAL entry + FCM push.
- [ ] **Status log is the only resume context**: a worker started fresh against an in-flight spec, with no in-memory state and no continuation prompt, finishes the work correctly. This is the load-bearing test.

## Architecture decisions

**Process runtime**: Bun. Fast startup (matters for crash-restart latency), good filesystem APIs, single-binary distributable. Manager and Concierge are separate Bun processes — never threads, never fibers, so OS-level supervision and `kill` work cleanly.

**Subprocess spawning**: Manager spawns workers via `claude` CLI in `--print --output-format=stream-json` mode so the event stream can be parsed line-by-line. Each worker writes its own `.devx-cache/events/<agent-id>.jsonl`; Manager tails them via `fs.watch` (mac) / `inotify` (linux).

**Token-usage detection**: stream-json output includes `usage` blocks per assistant turn. Manager keeps a running max; if `input_tokens / context_window > restart_on_token_pct`, kill + respawn. Fallback if usage isn't exposed: wall-clock + `max_worker_age_min`.

**Lock primitive**: `O_EXCL` create on `.devx-cache/locks/<name>.lock` containing JSON `{pid, started_at, agent_class, hostname}`. Stale-lock takeover: heartbeat older than 5 min → log a `learn/` entry and force-take.

**Heartbeat**: Manager writes `.devx-cache/heartbeat.json` every 60s with `{pid, monotonic_uptime_s, last_tick_id, roster_size, schedule_version}`. Concierge reads same file; staleness > 5 min triggers respawn.

**Concierge status endpoint**: HTTP server on `127.0.0.1:7322` (configurable), returns `{manager_alive, manager_uptime_s, roster, last_tick_age_s}`. Polled by cloud watchdog through an authenticated tunnel **or**, if unreachable, the watchdog falls back to tailing recent commits on `develop`.

**Notification dispatch**: Concierge subscribes to a derived `events/manager.jsonl` (Manager's own high-level transitions) — *not* the per-worker streams. Manager is responsible for rolling worker events into mobile-appropriate transitions; Concierge just maps + filters per `notifications.events` and pushes to channels.

**Spec-file as resume context**: when a worker starts (fresh or respawned), its prompt is a deterministic template:
```
You are a {role}. Continue work on the spec at {spec_path}. Read its frontmatter,
acceptance criteria, technical notes, and full status log to determine where the
last attempt left off. Then continue from that point. If the spec is fully done,
mark it status: done and exit.
```
No continuation snippets. No human relay. The spec file IS the state.

## Sub-specs to spawn

When this plan moves from `ready` → `in-progress`, the planner emits these into `dev/`:

```
dev/dev-c40001-2026-04-26T19:05-manage-process-skeleton.md
dev/dev-c40002-2026-04-26T19:05-event-stream-emit-consume.md
dev/dev-c40003-2026-04-26T19:05-context-rot-detector.md
dev/dev-c40004-2026-04-26T19:05-restart-from-status-log.md
dev/dev-c40005-2026-04-26T19:05-crash-recovery-from-disk.md
dev/dev-c40006-2026-04-26T19:05-concierge-router.md
dev/dev-c40007-2026-04-26T19:05-concierge-notifications.md
dev/dev-c40008-2026-04-26T19:05-mutual-watchdog.md
dev/dev-c40009-2026-04-26T19:05-cloud-watchdog-cron.md
dev/dev-c40010-2026-04-26T19:05-devx-ask-cli.md
dev/dev-c40011-2026-04-26T19:05-devx-no-args-auto-pick.md
```

Each gets seeded into `DEV.md` with its blocked-by chain. `c40011` (auto-pick) blocks none — it's a quick win shippable in parallel.

## Open questions

- **Token-usage exposure**: does `claude --print --output-format=stream-json` actually surface `usage` per assistant turn in the current CLI? **TBD** — verify before locking the rot-detector design; if not, fall back to wall-clock.
- **Concierge tunnel for cloud watchdog**: for users behind NAT, the cloud watchdog can't poll `localhost:7322` directly. Options: (a) Concierge pushes a heartbeat *to* the Worker every 5 min; cloud watchdog reads from there. (b) accept that NAT users only get the "tail recent commits" fallback. **Lean (a)** — same Worker we already run for FCM relay.
- **Spec lock granularity**: lock per `<hash>` only, or include `<role>` so PlanAgent and DevAgent can simultaneously work the same hash if it has both planning *and* implementation phases? **Lean per-hash-only** for simplicity; revisit if the dual-role case becomes real.
- **Worker prompt template**: should the resume template instruct the worker to read sibling specs (e.g., spec's `from:` chain)? Probably yes for context, but could blow context budget on deep chains. **Cap at 2 levels of `from:` traversal** — usually enough.

## Risks

- **Bun maturity on macOS launchd**: launchd-managed Bun processes are less battle-tested than Node. If we hit weird respawn behavior, fallback is plain Node — same code, same APIs, ~2× startup cost.
- **`fs.watch` reliability on macOS**: known to drop events under load. Mitigation: every Manager tick (5s) does a directory listing diff as a safety net, regardless of watch events.
- **Stream-json parsing churn**: if Anthropic CLI evolves the format mid-build, the rot detector breaks silently. Mitigation: pin the CLI version in `devx.config.yaml → manager.claude_cli_version`; fail loud on mismatch.
- **OS-supervisor permissions on first run**: macOS will prompt the user to allow the LaunchAgent on first install. One-time annoyance, not a blocker — call it out in `/devx-init` output.
- **GitHub Actions cron min granularity**: 5-min minimum means cloud-watchdog recovery is bounded above by ~30 min. Fine for laptop-asleep, would not be fine for production. Acceptable for v0.1.

## Checkbox conventions

This is the canonical decision on backlog markers (referenced from DESIGN.md):

| Marker | Meaning | Worker behavior |
|---|---|---|
| `[ ]` | `ready` — claimable | `/devx` no-args picks the top one |
| `[/]` | `in-progress` — claimed by a worker | skip; spec lock is held |
| `[-]` | `blocked` — waiting on INTERVIEW / MANUAL / dependency | skip; Manager polls for unblock |
| `[x]` | `done` — merged to `develop` | skip; archived after `storage.spec_archive_after_days` |
| line wrapped in `~~…~~` | `deleted` / abandoned | skip; kept for audit |

The `Status:` field on the entry is the source of truth; the checkbox is the glanceable mirror. Manager keeps them in sync — if you hand-edit the checkbox, Manager rewrites Status to match on the next reconcile tick. If you hand-edit Status, the checkbox follows.

## Status log

- 2026-04-26T19:00 — created by Leonid as Phase 2 master plan

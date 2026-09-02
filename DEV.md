# DEV — Features to build

Backlog for `/dev` to pick up. Each entry points at a spec file under `dev/`.

## Vision-gap tracks (plans: b3f7a1 → c8e2d4 → e5a9c0 → f1d6b2)

Owner-approved 2026-07-14 drift audit (`PLAN.md § Vision-gap tracks`):
portability & install → usage-window governor → interim blocker push →
fleet layer. Dev specs are emitted here by `/devx-plan` as each track is
planned; this section outranks the paused mobile backlog below.

### Epic — portability-install (Track 1, plan: b3f7a1)
- [x] `dev/dev-pin101-2026-07-14T12:00-packaged-skills-mirror.md` — Packaged skills mirror + drift guard (skills/, sync script, npm-test lock). Status: done. From: epic-portability-install. PR: https://github.com/LeoTheMighty/devx/pull/69 (merged 33d236c)
- [x] `dev/dev-pin102-2026-07-14T12:01-skills-installer-library.md` — Skills installer library (init-skills.ts pure decision fn + atomic applier). Status: done. Blocked-by: pin101. PR: https://github.com/LeoTheMighty/devx/pull/70 (merged adebcf1)
- [x] `dev/dev-pin103-2026-07-14T12:02-init-noninteractive-scaffold.md` — Bare `devx init` non-interactive scaffold (defaults AnswerProvider + skills install). Status: done. Blocked-by: pin102. PR: https://github.com/LeoTheMighty/devx/pull/73 (merged f56ddb5).
- [x] `dev/dev-pin104-2026-07-14T12:03-install-global-sha-docs.md` — install:global + SHA provenance + docs-to-reality. Status: done. Blocked-by: pin101. Parallel-safe with pin102/pin103. PR: https://github.com/LeoTheMighty/devx/pull/74 (merged 4e6bc43).
- [-] `dev/dev-pin105-2026-07-14T12:04-s5-validation.md` — S-5 validation: timed scratch scenario + live palateful checklist. Status: blocked (scripted half merged; live half waits on MANUAL MV-pin105.1). Blocked-by: pin103, pin104. Requires user action (live palateful run). PR: https://github.com/LeoTheMighty/devx/pull/75 (merged f9e4428; scripted half).
- [x] `dev/dev-pinret-2026-07-14T11:11-retro-portability-install.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: pin101, pin102, pin103, pin104, pin105. PR: https://github.com/LeoTheMighty/devx/pull/141 (merged 26b64bd)

## Cross-cutting plans

### Review tour retirement
- [x] `dev/dev-tur101-2026-08-04T10:00-retire-review-tour.md` — Retire the review tour: rip out `src/lib/tour/` + `devx tour` CLI + `/devx` Phase 7.5 + the `## 🗺 Review tour` PR-body section + `v2/03-review-tour.md`; rehome the shared exec seam; drop `diff2html` + `marked` deps. `/devx address` and the `devx: hold` gate survive. Status: done. Owner call 2026-08-04. PR: https://github.com/LeoTheMighty/devx/pull/113 (merged 8fc3a72).

### Retro-loop autonomy (from the 2026-08-05 learn-watch triage)

Two sessions sat pending in `~/.claude/devx/learn-queue.jsonl` since
2026-08-02 behind the once-per-repo allow prompt, with no human at a
terminal to answer it. Owner-requested: the watcher should drain
unattended, and the retros it spawns should carry their findings to a
merged change instead of stopping at an unread evidence table.

- [x] `dev/dev-28b267-2026-08-05T11:25-learn-auto-allow.md` — `learn.auto_allow`: unreviewed repos serve instead of blocking an unattended watcher (recorded `deny` still wins; the policy never writes `repos.json`). Status: done. From: 2026-08-05 triage session. PR: https://github.com/LeoTheMighty/devx/pull/119 (merged bc7fe84)
- [x] `dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md` — `/devx-learn` unattended mode: auto-prune rule, `devx learn-helper route` apply-vs-propose predicate (wedge paths can't be edited in an unattended tab), applied rows through the normal PR + merge gate, durable report. Status: done. Blocked-by: 28b267. **Carries an owner ruling** — whether locked machinery (gate logic, refusal paths, verdict vocabulary, append-only disciplines) stays proposal-only in auto mode. PR: https://github.com/LeoTheMighty/devx/pull/136

### Self-healing state reconciliation (from loop-2026-07-24 post-mortem)
- [x] `dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md` — `devx doctor` — mechanical state reconciliation (stale locks, dead owners, mirror drift, bookkeeping-only abandonments), `--fix` for the mechanical class, wired into `devx next` drift rows + loop start. Status: done — **blocker cleared, scope grown 2026-08-12.** Blocked-by: dc7514 (done, PR #84). Now also owns (a) the SOURCE fix — `mark-done` must release the spec lock, absorbing `ee7049` and `b931a1` AC 3, so doctor stops being a mop for a preventable leak — and (b) a new **dead-blocker** detector. Second field dataset in its Status log from the `9e1d9d3` manual pass: 14 stale locks, 2 dead-owner claims needing OPPOSITE verdicts (one released, one holding 132 uncommitted lines), 2 mirror drifts, 8 dead blockers, 2 orphan worktrees. **Sequencing: land `debug-ecdcda` first** — the suite is red at `d5336ff`, so this item's "full suite green" AC cannot be met until it is. From: debug-dc7514. PR: https://github.com/LeoTheMighty/devx/pull/139 (merged bf25634)
- [x] `dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md` — `devx devx-helper finalize <hash>` — merge-tail primitive: scoped staging (kills the `git add -A` peer-file sweep), spec-lock release (4/6 mlc specs leaked), clock-stamped merge line, and a post-merge rebuild of the self-hosted `dist/` (mlc106 merged unreachable from the CLI). Status: done — **RE-SCOPED 2026-08-12, roughly half already delivered; re-read before starting.** Scoped staging (E1) is DONE: sgr105 shipped `devx devx-helper mark-done`, which returns the exact pathspecs it wrote, and `.claude/commands/devx.md` Phase 8 step 5 now mandates `git add -- <paths>`. The clock stamp (E5) is DONE: mark-done carries a clock seam. Spec-lock release (E3) MOVED to `db36af`, together with ee7049, so the primitive is written once. **Remaining scope: E2 only** — the post-merge rebuild of the self-hosted `dist/`, still absent from Phase 8 (a story's local gate rebuilds its WORKTREE's dist, never main's, so `devx` on PATH lags merged work). Decide whether a `finalize` wrapper is still worth it once E1/E3/E5 live elsewhere, or whether E2 is a three-line addition to Phase 8. From: mlcret retro E1/E2/E3/E5. PR: https://github.com/LeoTheMighty/devx/pull/138 (merged cdfd3dc)
- [x] `dev/dev-lpf101-2026-07-26T15:57-loop-preflight-main-health.md` — Loop preflight main-health check (probe main CI at run start; refuse-with-reason or forced-start baseline line — red main taxed every hfi102 worker iteration). Status: done. From: hfiret retro E7. PR: https://github.com/LeoTheMighty/devx/pull/90 (merged 7b08627).

### Epic — harness-fold-in (plan: eac479)
- [x] `dev/dev-hfi101-2026-07-24T10:41-todo-core.md` — Todo core — template, parser, scaffold, gate isolation (E-1, E-2). Status: done. From: epic-harness-fold-in. PR: https://github.com/LeoTheMighty/devx/pull/80
- [x] `dev/dev-hfi102-2026-07-24T10:41-gate-verdict-persistence.md` — Gate-verdict persistence + revise clearing + gate summary (E-3). Status: done. (Loop-implemented, abandoned on iteration budget, revived interactively.) PR: https://github.com/LeoTheMighty/devx/pull/83
- [x] `dev/dev-hfi103-2026-07-24T10:41-todo-sync-renderers-status.md` — Todo sync + focus/drift renderers + real devx status (E-4, E-5). Status: done. (Loop-abandoned 2026-07-25 on 3 hung worker iterations — no work produced; state reset.) Blocked-by: hfi101, hfi102 (both done). PR: https://github.com/LeoTheMighty/devx/pull/85 (merged bf94928)
- [x] `dev/dev-hfi104-2026-07-24T10:41-devx-learn-skill.md` — /devx-learn skill + slug helper (E-6). Status: done. Parallel-safe with hfi101/hfi102/hfi103 (no shared files). PR: https://github.com/LeoTheMighty/devx/pull/81
- [x] `dev/dev-hfi105-2026-07-24T10:41-lifecycle-skill-wiring.md` — Lifecycle skill wiring + nudge single-sourcing (E-7). Status: done. Blocked-by: hfi103, hfi104. PR: https://github.com/LeoTheMighty/devx/pull/86 (merged 9070cd3)
- [x] `dev/dev-hfiret-2026-07-24T10:43-retro-harness-fold-in.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: hfi101, hfi102, hfi103, hfi104, hfi105 (all done). PR: https://github.com/LeoTheMighty/devx/pull/87 (merged 3b20151)

### Epic — multi-loop-concurrency (plan: 20eb6f)

Owner-requested 2026-07-28: N concurrent scoped `devx loop`s on one repo,
overlap-safe by construction (race inventory R1–R12 in the plan spec).
Serial chain — every story touches claim.ts/driver.ts.

- [x] `dev/dev-mlc101-2026-07-28T09:02-canonical-repo-root.md` — Canonical repo root + worktree refusal (kills R1). Status: done. From: epic-multi-loop-concurrency. PR: https://github.com/LeoTheMighty/devx/pull/91 (merged 68646b3).
- [x] `dev/dev-mlc102-2026-07-28T09:02-backlog-mutation-lock.md` — Backlog mutation lock + atomic-writer conversion (kills R3/R4/R10). Status: done. Blocked-by: mlc101. PR: https://github.com/LeoTheMighty/devx/pull/93 (merged daaa873)
- [x] `dev/dev-mlc103-2026-07-28T09:02-spec-lock-lifecycle.md` — Spec-lock lifecycle: classify, reap, guarded release + pick-time masking (kills R7/R8/R12; G-3). Status: done. Blocked-by: mlc102. PR: https://github.com/LeoTheMighty/devx/pull/94 (merged f5fa72f)
- [x] `dev/dev-mlc104-2026-07-28T09:02-claim-contention-harness.md` — Claim contention + overlap harness (kills R2/R5; G-1). Status: done. Blocked-by: mlc103. PR: https://github.com/LeoTheMighty/devx/pull/96 (merged 3c9f2c0)
- [x] `dev/dev-mlc105-2026-07-28T09:02-instance-registry-admission.md` — Loop instance registry + capacity admission + next/status aggregation + scratch namespacing (kills R6/R11). Status: done. Blocked-by: mlc104. PR: https://github.com/LeoTheMighty/devx/pull/98 (merged a19eb6d)
- [x] `dev/dev-mlc106-2026-07-28T09:02-scope-model-flags.md` — Scope model: epic-aware rows + --epic/--workstream/--items/--exclude/--focus + E-8 sweep. Status: done. Blocked-by: mlc105. PR: https://github.com/LeoTheMighty/devx/pull/100 (merged 1cdf435)
- [x] `dev/dev-mlcret-2026-07-28T09:04-retro-multi-loop-concurrency.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: mlc101, mlc102, mlc103, mlc104, mlc105, mlc106. PR: https://github.com/LeoTheMighty/devx/pull/103 (merged 034756f). Also carries the fix for the `loop-driver` ENOTEMPTY teardown flake (test-b7f2c1).

### Epic — mid-story-split (plan: e0a67e)

First-class mid-story splits: remaining work becomes a fresh spec wired
into the dependency tree (merge-first / branch-handoff shapes), the loop
splits instead of abandoning on real progress, and the Handoff Snippet
contract retires. Deps: mss101 → {mss102, mss103} → mss104; mss102 and
mss103 are parallel-safe (no shared files).

- [x] `dev/dev-mss101-2026-07-28T13:43-split-primitive-lib-cli.md` — Split primitive (lib + CLI). Status: done. From: epic-mid-story-split. PR: https://github.com/LeoTheMighty/devx/pull/95 (merged ec3af6e)
- [x] `dev/dev-mss102-2026-07-28T13:43-claim-branch-inheritance.md` — Claim branch inheritance. Status: done. Blocked-by: mss101. Parallel-safe with mss103. PR: https://github.com/LeoTheMighty/devx/pull/97 (merged 46fb9e4)
- [x] `dev/dev-mss103-2026-07-28T13:43-loop-split-integration.md` — Loop split integration. Status: done. Blocked-by: mss101. Parallel-safe with mss102. PR: https://github.com/LeoTheMighty/devx/pull/99 (merged 962f9a1)
- [x] `dev/dev-mss104-2026-07-28T13:43-handoff-snippet-retirement.md` — Handoff Snippet retirement sweep. Status: done. Blocked-by: mss102, mss103. PR: https://github.com/LeoTheMighty/devx/pull/101 (merged 5292b19)
- [x] `dev/dev-mssret-2026-07-28T13:45-retro-mid-story-split.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: mss101, mss102, mss103, mss104. PR: https://github.com/LeoTheMighty/devx/pull/141 (merged 26b64bd)
- ~~`dev/dev-ee7049-2026-07-29T10:12-spec-lock-release-cli.md` — Guarded spec-lock release CLI for the Phase 9 branch-handoff path (swaps the raw `rm` for `devx devx-helper release-lock`).~~ Status: absorbed 2026-08-12 into `db36af`, which now owns the release primitive and its three call sites (mark-done, loop merge tail, `doctor --fix`). Not "low priority" after all: the missing release is the SOURCE of the 14 stale locks cleared in `9e1d9d3`, and `.claude/commands/devx.md:478` still instructs a raw `rm .devx-cache/locks/spec-<hash>.lock`. Kept for audit. From: mss104 Phase 8 gap sweep.

## Phase 0 — Foundation (plan: plan-a01000)

### Epic 1 — BMAD audit
- [x] `dev/dev-aud101-2026-04-26T19:35-bmad-modules-inventory.md` — Inventory BMAD modules + workflows. Status: done. From: epic-bmad-audit. PR: https://github.com/LeoTheMighty/devx/pull/1 (merged 70872e4).
- [x] `dev/dev-aud102-2026-04-26T19:35-bmad-classify-workflows.md` — Classify each BMAD workflow + map to devx command. Status: done. From: epic-bmad-audit. PR: https://github.com/LeoTheMighty/devx/pull/2 (merged 2697f54).
- [x] `dev/dev-aud103-2026-04-26T19:35-bmad-risks-finalize.md` — Risks subsection + finalize bmad-audit.md. Status: done. From: epic-bmad-audit. PR: https://github.com/LeoTheMighty/devx/pull/3 (merged 82ed445).
- [x] `dev/dev-audret-2026-04-27T08:00-retro-bmad-audit.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: done. From: epic-bmad-audit. PR: https://github.com/LeoTheMighty/devx/pull/19 (merged 7444b11).

### Epic 2 — devx.config.yaml schema + CLI
- [x] `dev/dev-cfg201-2026-04-26T19:35-config-schema-json.md` — JSON schema for all 15 sections of devx.config.yaml. Status: done. From: epic-config-schema. PR: https://github.com/LeoTheMighty/devx/pull/4 (merged cb73bc5).
- [x] `dev/dev-cfg202-2026-04-26T19:35-config-yaml-roundtrip-lib.md` — YAML round-trip lib using eemeli/yaml. Status: done. From: epic-config-schema. PR: https://github.com/LeoTheMighty/devx/pull/5 (merged c6a5625).
- [x] `dev/dev-cfg203-2026-04-26T19:35-config-validation-on-load.md` — Config validation on load. Status: done. Blocked-by: cfg201, cfg202. PR: https://github.com/LeoTheMighty/devx/pull/6 (merged b00ef2e).
- [x] `dev/dev-cfg204-2026-04-26T19:35-config-cli-get-set.md` — `devx config <key>` get/set CLI. Status: done. Blocked-by: cfg202, cfg203, cli301. PR: https://github.com/LeoTheMighty/devx/pull/8 (merged 1ba275f).
- [x] `dev/dev-cfgret-2026-04-27T08:00-retro-config-schema.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: done. Blocked-by: cfg201, cfg202, cfg203, cfg204. PR: https://github.com/LeoTheMighty/devx/pull/20 (merged 7440a05).

### Epic 3 — devx CLI skeleton
- [x] `dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md` — npm package scaffold + commander dispatch. Status: done. From: epic-cli-skeleton. PR: https://github.com/LeoTheMighty/devx/pull/7 (merged 3641bd6).
- [x] `dev/dev-cli302-2026-04-26T19:35-cli-stubs.md` — Stub helper + 10 stub commands registered. Status: done. Blocked-by: cli301. PR: https://github.com/LeoTheMighty/devx/pull/9 (merged 379a79e).
- [x] `dev/dev-cli303-2026-04-26T19:35-cli-help-listing.md` — `devx --help` listing with phase + epic annotations. Status: done. Blocked-by: cli302, cfg204. PR: https://github.com/LeoTheMighty/devx/pull/10 (merged fa48586).
- [x] `dev/dev-cli304-2026-04-26T19:35-cli-version-postinstall.md` — `devx --version` + postinstall PATH verification. Status: done. Blocked-by: cli301. PR: https://github.com/LeoTheMighty/devx/pull/11 (merged 17428b9).
- [x] `dev/dev-cli305-2026-04-26T19:35-cli-cross-platform-install.md` — Cross-platform install + WSL PATH detection. Status: done. Blocked-by: cli304. PR: https://github.com/LeoTheMighty/devx/pull/12 (merged 1a58274).
- [x] `dev/dev-cliret-2026-04-27T08:00-retro-cli-skeleton.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: done. Blocked-by: cli301, cli302, cli303, cli304, cli305. PR: https://github.com/LeoTheMighty/devx/pull/21 (merged 27f0f55).

### Epic 4 — OS supervisor scaffold
- [x] `dev/dev-sup401-2026-04-26T19:35-supervisor-stub-script.md` — Supervisor stub script + idempotent install. Status: done. From: epic-os-supervisor-scaffold. Blocked-by: cli301. PR: https://github.com/LeoTheMighty/devx/pull/13 (merged b6bb9dd).
- [x] `dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md` — macOS launchd plist generator + bootstrap. Status: done. Blocked-by: sup401. PR: https://github.com/LeoTheMighty/devx/pull/14 (merged c2c7044).
- [x] `dev/dev-sup403-2026-04-26T19:35-supervisor-systemd.md` — Linux systemd-user .service generator + enable. Status: done. Blocked-by: sup401. PR: https://github.com/LeoTheMighty/devx/pull/15 (merged c51bd91).
- [x] `dev/dev-sup404-2026-04-26T19:35-supervisor-task-scheduler.md` — Windows/WSL Task Scheduler XML generator. Status: done. Blocked-by: sup401. PR: https://github.com/LeoTheMighty/devx/pull/16 (merged 1c260ad).
- [x] `dev/dev-sup405-2026-04-26T19:35-supervisor-platform-detect.md` — Platform auto-detect dispatch + post-install verification. Status: done. Blocked-by: sup402, sup403, sup404. PR: https://github.com/LeoTheMighty/devx/pull/17 (merged 322bbb4).
- [x] `dev/dev-supret-2026-04-27T08:00-retro-os-supervisor-scaffold.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: done. Blocked-by: sup401, sup402, sup403, sup404, sup405. PR: https://github.com/LeoTheMighty/devx/pull/22 (merged 0e9d6b3).

### Epic 5 — `/devx-init` skill
- [x] `dev/dev-ini501-2026-04-26T19:35-init-question-flow.md` — 13-question flow + skip-table inference + state detection. Status: done. From: epic-init-skill. Blocked-by: aud103, cli301. PR: https://github.com/LeoTheMighty/devx/pull/18 (merged 3baf1a9).
- [x] `dev/dev-ini502-2026-04-26T19:35-init-local-writes.md` — Local file writes (config + backlogs + spec dirs + CLAUDE.md + .gitignore). Status: done. Blocked-by: ini501, cfg204. PR: https://github.com/LeoTheMighty/devx/pull/23 (merged 1d98b6c).
- [x] `dev/dev-ini503-2026-04-26T19:35-init-github-scaffolding.md` — GitHub-side scaffolding (workflows + PR template + develop + protection). Status: done. Blocked-by: ini502. PR: https://github.com/LeoTheMighty/devx/pull/24 (merged 036b7e7).
- [x] `dev/dev-ini504-2026-04-26T19:35-init-personas-and-interview.md` — Personas + INTERVIEW.md fixed-template seeding. Status: done. Blocked-by: ini502. PR: https://github.com/LeoTheMighty/devx/pull/25 (merged aeb09ee).
- [x] `dev/dev-ini505-2026-04-26T19:35-init-supervisor-trigger.md` — Supervisor installer trigger + verify. Status: done. Blocked-by: ini502, sup405. PR: https://github.com/LeoTheMighty/devx/pull/26 (merged 54f8443).
- [x] `dev/dev-ini506-2026-04-26T19:35-init-failure-modes.md` — Failure-mode handling (BMAD-fail / gh-not-auth / no-remote). Status: done. Blocked-by: ini503, ini505. PR: https://github.com/LeoTheMighty/devx/pull/27 (merged addac3c).
- [x] `dev/dev-ini507-2026-04-26T19:35-init-idempotent-upgrade.md` — Idempotent upgrade-mode re-run. Status: done. Blocked-by: ini502, ini503, ini504, ini505. PR: https://github.com/LeoTheMighty/devx/pull/28 (merged 20b126d).
- [x] `dev/dev-ini508-2026-04-26T19:35-init-end-to-end-test.md` — End-to-end integration test. Status: done. Blocked-by: ini506, ini507. PR: https://github.com/LeoTheMighty/devx/pull/29 (merged fa0aa0e).
- [x] `dev/dev-iniret-2026-04-27T08:00-retro-init-skill.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: done. Blocked-by: ini501, ini502, ini503, ini504, ini505, ini506, ini507, ini508. PR: https://github.com/LeoTheMighty/devx/pull/30 (merged 2634254). Phase 0 closed.

## Mobile companion v0.1 (plan: plan-7a2d1f) — PAUSED 2026-07-14

**Paused until the fleet layer (f1d6b2) ships** — vision-gap tracks above
execute first (owner sequencing decision 2026-07-14; this backlog was also
gated on user actions: Apple Team ID, on-device run, App Store Connect).
Statuses below stay `ready` — the section is outranked, not blocked; the
Track 3 interim GitHub notifier is retired by this backlog's Epic 4 relay
when it resumes.

### Epic 1 — Flutter scaffold & iOS on device (M1)
- [x] `dev/dev-a10001-2026-04-23T13:01-flutter-project-scaffold.md` — Flutter project scaffold + nav shell. Status: done. From: epic-flutter-scaffold-ios-device. PR: https://github.com/LeoTheMighty/devx/pull/76 (merged 4e5e541)
- [x] `dev/dev-a10002-2026-04-23T13:02-riverpod-theme-router.md` — Riverpod + Material 3 theme + go_router foundations. Status: done. Blocked-by: a10001. PR: https://github.com/LeoTheMighty/devx/pull/77 (merged b0223bd)
- [-] `dev/dev-a10003-2026-04-23T13:03-ios-project-config.md` — iOS project configuration (bundle ID, signing, push capability). Status: blocked (MANUAL M1.1 — Apple Team ID). Blocked-by: a10001. Requires user action (Team ID).
- [ ] `dev/dev-a10004-2026-04-23T13:04-first-ondevice-run.md` — First on-device run. Status: ready. Blocked-by: a10002, a10003. Requires user action (plug in phone).
- [ ] `dev/dev-a10005-2026-04-23T13:05-testflight-pipeline.md` — TestFlight pipeline. Status: ready. Blocked-by: a10004. Requires user action (App Store Connect upload).
- [ ] `dev/dev-a10ret-2026-04-27T08:00-retro-flutter-scaffold.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: ready. Blocked-by: a10001, a10002, a10003, a10004, a10005.

### Epic 2 — GitHub connection read (M2)
- [ ] `dev/dev-b20001-2026-04-23T13:10-auth-service-onboarding.md` — Auth service + PAT onboarding screen. Status: ready. Blocked-by: a10005.
- [ ] `dev/dev-b20002-2026-04-23T13:11-github-client-wrapper.md` — GitHub client wrapper + Contents read client. Status: ready. Blocked-by: b20001.
- [ ] `dev/dev-b20003-2026-04-23T13:12-backlog-parser.md` — Backlog markdown → structured model parser. Status: ready. Blocked-by: b20002.
- [ ] `dev/dev-b20004-2026-04-23T13:13-inbox-tab.md` — Inbox tab — INTERVIEW + MANUAL + open PRs. Status: ready. Blocked-by: b20003.
- [ ] `dev/dev-b20005-2026-04-23T13:14-backlogs-tab-spec-detail.md` — Backlogs tab + spec detail view. Status: ready. Blocked-by: b20003.
- [ ] `dev/dev-b20ret-2026-04-27T08:00-retro-github-connection-read.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: ready. Blocked-by: b20001, b20002, b20003, b20004, b20005.

### Epic 3 — Bidirectional writes + offline (M3)
- [ ] `dev/dev-c30001-2026-04-23T13:20-offline-queue-drift.md` — Offline queue foundation. Status: ready. Blocked-by: b20005.
- [ ] `dev/dev-c30002-2026-04-23T13:21-git-data-api-client.md` — Git Data API client (atomic multi-file commit). Status: ready. Blocked-by: b20002.
- [ ] `dev/dev-c30003-2026-04-23T13:22-add-tab-plus-button.md` — Add tab — (+) button flow. Status: ready. Blocked-by: c30001, c30002.
- [ ] `dev/dev-c30004-2026-04-23T13:23-inline-interview-answer.md` — Inline INTERVIEW answering. Status: ready. Blocked-by: c30001, b20004.
- [ ] `dev/dev-c30005-2026-04-23T13:24-conflict-resolution-ui.md` — Conflict resolution UI. Status: ready. Blocked-by: c30003, c30004.
- [ ] `dev/dev-c30ret-2026-04-27T08:00-retro-bidirectional-writes-offline.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: ready. Blocked-by: c30001, c30002, c30003, c30004, c30005.

### Epic 4 — Real-time updates (M4)
- [ ] `dev/dev-d40001-2026-04-23T13:30-cloudflare-worker-scaffold.md` — Cloudflare Worker scaffold + HMAC verification. Status: ready. Blocked-by: c30005.
- [ ] `dev/dev-d40002-2026-04-23T13:31-fcm-sender.md` — FCM sender + service-account JWT auth. Status: ready. Blocked-by: d40001. Requires user action (Firebase project).
- [ ] `dev/dev-d40003-2026-04-23T13:32-event-filters-fanout.md` — Event filters + fanout to device tokens. Status: ready. Blocked-by: d40002.
- [ ] `dev/dev-d40004-2026-04-23T13:33-device-registration.md` — Device registration + deregistration endpoints. Status: ready. Blocked-by: d40001.
- [ ] `dev/dev-d40005-2026-04-23T13:34-flutter-fcm-integration.md` — Flutter firebase_messaging integration. Status: ready. Blocked-by: d40004. Requires user action (GoogleService-Info.plist).
- [ ] `dev/dev-d40006-2026-04-23T13:35-deep-linking-inline-reply.md` — Deep-linking + iOS inline-reply. Status: ready. Blocked-by: d40005.
- [ ] `dev/dev-d40007-2026-04-23T13:36-laptop-fastpath-webhook.md` — Laptop-side fast-path webhook receiver. Status: ready. Blocked-by: d40003. Optional.
- [ ] `dev/dev-d40ret-2026-04-27T08:00-retro-realtime-updates-push.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: ready. Blocked-by: d40001, d40002, d40003, d40004, d40005, d40006, d40007.

## Phase 1 — Single-agent core loop (plan: plan-b01000)

### Epic 1 — Mode-derived merge gate (renamed from epic-promotion-gate-yolo-beta)
- [x] `dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md` — mergeGateFor() pure function + truth-table tests. Status: done. From: epic-merge-gate-modes. PR: https://github.com/LeoTheMighty/devx/pull/31 (merged 48cbd2f).
- [x] `dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md` — devx merge-gate <hash> CLI passthrough + /devx Phase 8 integration. Status: done. Blocked-by: mrg101. PR: https://github.com/LeoTheMighty/devx/pull/32 (merged dc86eb7).
- [x] `dev/dev-mrg103-2026-04-28T19:30-promote-integration.md` — Develop→main promotion code path (latent / dead-code-until-split-branch). Status: done. Blocked-by: mrg101. PR: https://github.com/LeoTheMighty/devx/pull/33 (merged 937624e).
- [x] `dev/dev-mrgret-2026-04-28T19:30-retro-merge-gate-modes.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: mrg101, mrg102, mrg103. PR: https://github.com/LeoTheMighty/devx/pull/34 (merged 34a605b). Closes epic-merge-gate-modes 4/4.

### Epic 2 — PR template (spec link as first line + Mode stamp)
- [x] `dev/dev-prt101-2026-04-28T19:30-pr-template-init-write.md` — Template ships + /devx-init writes it idempotently. Status: done. From: epic-pr-template. PR: https://github.com/LeoTheMighty/devx/pull/35 (merged ea4050f).
- [x] `dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md` — /devx Phase 7 reads template + substitutes mode + spec path. Status: done. Blocked-by: prt101. PR: https://github.com/LeoTheMighty/devx/pull/36 (merged 5f18386).
- [x] `dev/dev-prtret-2026-04-28T19:30-retro-pr-template.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: prt101, prt102. PR: https://github.com/LeoTheMighty/devx/pull/37 (merged c4fc396). Closes epic-pr-template 3/3.

### Epic 3 — /devx-plan skill (canonical PlanAgent)
- [x] `dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md` — deriveBranch() helper + devx plan-helper derive-branch CLI. Status: done. From: epic-devx-plan-skill. PR: https://github.com/LeoTheMighty/devx/pull/38 (merged 6538bf0).
- [x] `dev/dev-pln102-2026-04-28T19:30-plan-emit-retro.md` — emitRetroStory() helper + retro-row co-emission discipline. Status: done. Blocked-by: pln101. PR: https://github.com/LeoTheMighty/devx/pull/39 (merged efea1c2).
- [x] `dev/dev-pln103-2026-04-28T19:30-plan-validate-emit.md` — devx plan-helper validate-emit cross-reference checker. Status: done. Blocked-by: pln101, pln102. PR: https://github.com/LeoTheMighty/devx/pull/40 (merged dd306af).
- [x] `dev/dev-pln104-2026-04-28T19:30-plan-precedence-enforcement.md` — Source-of-truth-precedence enforcement at planning time. Status: done. Blocked-by: pln103. PR: https://github.com/LeoTheMighty/devx/pull/41 (merged aea6708).
- [x] `dev/dev-pln105-2026-04-28T19:30-plan-mode-gate.md` — Phase 6.5 mode gate is structurally explicit. Status: done. Blocked-by: pln103. PR: https://github.com/LeoTheMighty/devx/pull/42 (merged bd7400f).
- [x] `dev/dev-pln106-2026-04-28T19:30-plan-summary-format.md` — Phase 8 final-summary Next command block format. Status: done. Blocked-by: pln102. PR: https://github.com/LeoTheMighty/devx/pull/43 (merged d9345bd).
- [x] `dev/dev-plnret-2026-04-28T19:30-retro-devx-plan-skill.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: pln101, pln102, pln103, pln104, pln105, pln106. PR: https://github.com/LeoTheMighty/devx/pull/44 (merged 6f84553). Closes epic-devx-plan-skill 7/7. Phase 1 progress: 3/5 epics shipped + retroed.

### Epic 4 — /devx skill (canonical DevAgent)
- [x] `dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md` — Atomic claim + push-before-PR + spec lock. Status: done. From: epic-devx-skill. Blocked-by: mrg102, prt102. PR: https://github.com/LeoTheMighty/devx/pull/45 (merged fc4261e).
- [x] `dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md` — Conditional bmad-create-story with canary flag. Status: done. Blocked-by: dvx101. PR: https://github.com/LeoTheMighty/devx/pull/46 (merged d8d64f8).
- [x] `dev/dev-dvx103-2026-04-28T19:30-devx-self-review-discipline.md` — Phase 4 self-review status-log assertion. Status: done. Blocked-by: dvx102. PR: https://github.com/LeoTheMighty/devx/pull/47 (merged b2a14f6).
- [x] `dev/dev-dvx104-2026-04-28T19:30-devx-coverage-gate.md` — Mode-derived coverage gate (Phase 5). Status: done. Blocked-by: dvx101. PR: https://github.com/LeoTheMighty/devx/pull/48 (merged 5d46173).
- [x] `dev/dev-dvx105-2026-04-28T19:30-devx-await-remote-ci.md` — Three-state remote-CI probe + ScheduleWakeup polling. Status: done. Blocked-by: dvx101. PR: https://github.com/LeoTheMighty/devx/pull/49 (merged 7a802e0).
- [x] `dev/dev-dvx106-2026-04-28T19:30-devx-auto-merge-gate.md` — Phase 8 auto-merge wired through devx merge-gate. Status: done. Blocked-by: dvx101, mrg102. PR: https://github.com/LeoTheMighty/devx/pull/50 (merged 8382409).
- [x] `dev/dev-dvx107-2026-04-28T19:30-devx-stop-after-handoff.md` — stop_after handling + Handoff Snippet on early stop. Status: done. Blocked-by: dvx106. PR: https://github.com/LeoTheMighty/devx/pull/51 (merged c1d1699).
- [x] `dev/dev-dvxret-2026-04-28T19:30-retro-devx-skill.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: dvx101, dvx102, dvx103, dvx104, dvx105, dvx106, dvx107. PR: https://github.com/LeoTheMighty/devx/pull/52 (merged c594811). Closes epic-devx-skill 8/8. Phase 1 progress: 4/5 epics shipped + retroed.

### Epic 5 — /devx-manage v0 (minimal scheduler + supervisor)
- [x] `dev/dev-mgr101-2026-04-28T19:30-manage-scaffold.md` — Manager scaffold + devx manage --once single-tick CLI. Status: done. From: epic-devx-manage-minimal. Blocked-by: dvxret. PR: https://github.com/LeoTheMighty/devx/pull/53 (merged efa23bf).
- [x] `dev/dev-mgr102-2026-04-28T19:30-manage-state-files.md` — State persistence: schedule.json + manager.json + heartbeat.json with atomic writes. Status: done. Blocked-by: mgr101. PR: https://github.com/LeoTheMighty/devx/pull/54 (merged 4366ae5).
- [x] `dev/dev-mgr103-2026-04-28T19:30-manage-reconcile.md` — Reconcile loop: read backlogs + compute diff + detect unblocks. Status: done. Blocked-by: mgr102. PR: https://github.com/LeoTheMighty/devx/pull/55 (merged ca42895).
- [x] `dev/dev-mgr104-2026-04-28T19:30-manage-spawn-worker.md` — Spawn one worker (hard cap N=1) + claude /devx <hash> subprocess. Status: done. Blocked-by: mgr103. PR: https://github.com/LeoTheMighty/devx/pull/56 (merged 3be0b9f).
- [x] `dev/dev-mgr105-2026-04-28T19:30-manage-crash-restart.md` — Plain-crash restart logic + max-restarts-per-spec gate. Status: done. Blocked-by: mgr104. PR: https://github.com/LeoTheMighty/devx/pull/57 (merged f64dddc).
- [x] `dev/dev-mgr106-2026-04-28T19:30-manage-lock-heartbeat.md` — Manager lock + heartbeat + SIGTERM-clean. Status: done. Blocked-by: mgr101. PR: https://github.com/LeoTheMighty/devx/pull/58 (merged 1a0fff4).
- [x] `dev/dev-mgrret-2026-04-28T19:30-retro-devx-manage-minimal.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: mgr101, mgr102, mgr103, mgr104, mgr105, mgr106. PR: https://github.com/LeoTheMighty/devx/pull/61 (merged 67c4c98). Closes epic-devx-manage-minimal 7/7; Phase 1 closed 5/5. Final BMAD retro.

### Follow-ups filed during Phase 1 retros
- [x] `dev/dev-roc101-2026-05-07T08:50-devx-resume-owner-check.md` — /devx Phase 1 resume-detection: `devx devx-helper verify-claim <hash>` + skill-body wire-up. Status: done. PR: https://github.com/LeoTheMighty/devx/pull/60 (merged 9fb3dc3). From: dvxret (LEARN.md § epic-devx-skill E13). Blocked-by: dvxret. Load-bearing for mgr104's worker-spawn discipline; stopgap docs change applied in dvxret PR (CLAUDE.md "Working agreements" — "Verify claim ownership before resuming").

## Phase V2 — Native engine migration (plan: v2/)

Source of truth: `v2/06-phases.md`. BMAD exits per `v2/01-bmad-capture.md`;
mgrret (above) is the final BMAD invocation. One item ≈ one phase ≈ one PR
(v2e102/v2x101 skill edits are user-foreground).

- [x] `dev/dev-v2s101-2026-07-05T13:00-v2-scaffold-templates.md` — V2.0-b/c engine template scaffold + backlog wiring. Status: done. From: v2/06-phases.md. PR: https://github.com/LeoTheMighty/devx/pull/59 (merged 9dd187d).
- [x] `dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md` — V2.1-A engine CLI primitives (workstream new, gate prd/coverage/evals, revise, next v1, prose canary). Status: done. Blocked-by: v2s101. PR: https://github.com/LeoTheMighty/devx/pull/62 (merged b6ab24c).
- [x] `dev/dev-v2e102-2026-07-05T13:02-stage-skill-bodies.md` — V2.1-B stage skill bodies (/devx prd|design|plan|red). Status: done. Blocked-by: v2e101. User-foreground. PR: https://github.com/LeoTheMighty/devx/pull/63 (merged 7c81b34). V2.1 closed; first real gate run (v2x101 workstream PRD→RED).
- [x] `dev/dev-v2x101-2026-07-05T13:03-execute-rehome-bmad-eject.md` — V2.2 execute re-home + BMAD ejection. Status: done. Blocked-by: v2e102, mgrret. User-foreground. PR: https://github.com/LeoTheMighty/devx/pull/64 (merged 3bbf14d). BMAD ejected; V2.2 closed.
- [x] `dev/dev-v2t101-2026-07-05T13:04-review-tour.md` — V2.3 static HTML review tour (build/publish/pr-body/address + devx: hold). Status: done. Blocked-by: v2x101. PR: https://github.com/LeoTheMighty/devx/pull/65 (merged b50ae57; first tour-bearing PR — tour: https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/v2t101/tour.html). V2.3 closed.
- [x] `dev/dev-v2d101-2026-07-05T13:05-universal-dispatcher.md` — V2.4 universal /devx dispatcher + debug loop + init v2. Status: done. Blocked-by: v2x101. PR: https://github.com/LeoTheMighty/devx/pull/66 (merged 66a7ccd). V2.4 closed.
- [x] `dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md` — V2.5 overnight loop (gnhf fold-in: iteration contract, failure ladder, budgets, morning report). Status: done. Blocked-by: v2d101, roc101. PR: https://github.com/LeoTheMighty/devx/pull/67 (merged b4423a8). V2.5 closed; S-3 supervised night filed as MANUAL.md MV2.1.
- [x] `dev/dev-v2o101-2026-07-05T13:07-outcome-loop.md` — V2.6 outcome loop + migration retro. Status: done. Blocked-by: v2l101. PR: https://github.com/LeoTheMighty/devx/pull/68 (merged d5caf94). V2.6 closed — Phase V2 complete 8/8 (+ roc101 + mgrret); retro: _devx/retros/v2-migration-2026-07-05.md.

### Epic — retro-listener (plan: 620c74)

Port of the 8am-harness retro listener (mycase/8am-harness PR #36): auto-spawn
`/devx-learn` when a session prints the friction nudge. Workstream artifacts:
`_devx/workstreams/retro-listener/`; RED report at `evals/RED-report.md`.

- [x] `dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md` — Listener — nudge pattern, queue store, `learn-helper listen`, wire-protocol pin (E-1, E-2, E-6, E-10, E-7). Status: done. From: epic-retro-listener. PR: https://github.com/LeoTheMighty/devx/pull/104
- [x] `dev/dev-rtl102-2026-07-30T09:31-learn-config-section.md` — `learn:` config section (idle window, retro timeout, home). Status: done. Parallel-safe with rtl101 (no shared files). PR: https://github.com/LeoTheMighty/devx/pull/105
- [x] `dev/dev-rtl103-2026-07-30T09:31-watcher-core.md` — Watcher core — readiness, allowlist, outcomes, queue ops (E-3, E-4 core). Status: done. Blocked-by: rtl101. PR: https://github.com/LeoTheMighty/devx/pull/106
- [x] `dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md` — Watcher CLI — spawn arms, drain loop, `devx learn-watch` (E-4, E-5, E-9). Status: done. Blocked-by: rtl102, rtl103. PR: https://github.com/LeoTheMighty/devx/pull/107 (merged 56a00d87).
- [ ] `dev/dev-9946f9-2026-07-30T14:07-human-smoke-of-the-devx-learn-watch-terminal-app-s.md` — Human smoke of the devx learn-watch Terminal.app spawn arm. Status: ready. Blocked-by: rtl104.
- [x] `dev/dev-rtl105-2026-07-30T09:31-init-hook-distribution.md` — Hook registration template + `/devx-init` distribution (E-8). Status: done. Blocked-by: rtl101. Parallel-safe with rtl103/rtl104. PR: https://github.com/LeoTheMighty/devx/pull/108
- [x] `dev/dev-rtl106-2026-07-30T09:31-outlet-routing-rework.md` — `/devx-learn` outlet routing rework (ordered five-outlet first-match). Status: done. Parallel-safe with rtl101–rtl105 (prose + tests only; marker byte-preserved). PR: https://github.com/LeoTheMighty/devx/pull/109 (merged 48ab09df).
- [x] `dev/dev-rtlret-2026-07-30T09:33-retro-retro-listener.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: rtl101, rtl102, rtl103, rtl104, rtl105, rtl106. PR: https://github.com/LeoTheMighty/devx/pull/141 (merged 26b64bd)
- [ ] `dev/dev-343b43-2026-08-21T14:10-harvest-loop-learnings.md` — `devx learnings <workstream>`: harvest the loop's per-iteration `- Learning:` lines so a retro can read them as a set instead of grepping six spec files. Status: ready. From: rtlret F1.
- [ ] `dev/dev-e2da94-2026-08-21T14:12-plan-stage-premise-and-eval-scope.md` — `/devx-plan` Design+Plan stages: name the command that verifies each claim about the EXISTING corpus, and derive a phase's AC file list from its eval's scan scope. Status: ready. From: mssret F1 + F4.

### Epic — story-graph (plan: 62bcd1)

Auto-generated GRAPH.md at the repo root: Mermaid DAG of all specs grouped
by workstream/epic, edge-source union + tokenizer hardening, regen hooks on
claim/emission/merge-cleanup, assisted backfill. Workstream artifacts:
`_devx/workstreams/story-graph/`; RED report at `evals/RED-report.md`.
Phases 6+7 are parallel-safe with 4/5 and each other modulo GRAPH.md +
backlog surfaces — on a GRAPH.md rebase conflict, never merge by hand,
re-run `devx graph`.

- [x] `dev/dev-sgr101-2026-08-02T13:57-parser-hardening.md` — Parser completion + hardening (splitHashes, parallel-safe, heading tolerance). Status: done. PR: https://github.com/LeoTheMighty/devx/pull/110 (merged 93b0aa4)
- [x] `dev/dev-sgr102-2026-08-02T13:57-graph-model.md` — Graph model — buildGraphModel nodes/edges/groups/warnings. Status: done. Blocked-by: sgr101. PR: https://github.com/LeoTheMighty/devx/pull/111 (merged dea72c1)
- [x] `dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md` — Renderer + devx graph CLI (E-1..E-4 go green, initial GRAPH.md). Attended-only: loop must `--exclude`. Status: done. Blocked-by: sgr102. PR: https://github.com/LeoTheMighty/devx/pull/112 (merged f41d545)
- [x] `dev/dev-sgr104-2026-08-02T13:57-regen-hooks-claim-emission.md` — Regen hooks — claim + RED emission keep GRAPH.md fresh. Status: done. Blocked-by: sgr103. PR: https://github.com/LeoTheMighty/devx/pull/114 (merged 6527aea)
- [x] `dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md` — mark-done helper + Phase-8 rewrite (E-5 goes green). Status: done. Blocked-by: sgr104. PR: https://github.com/LeoTheMighty/devx/pull/118 (merged 4928dd9)
- [x] `dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md` — Backfill — adds-only idempotent edge completion + attended devx-repo run (E-6). Attended-only: loop must `--exclude`. Status: done. Blocked-by: sgr103. Parallel-safe with sgr104/sgr105/sgr107. PR: https://github.com/LeoTheMighty/devx/pull/120 (merged 66720bd)
- [x] `dev/dev-sgr107-2026-08-02T13:57-downstream-portability.md` — Downstream portability — packaged CLI proof + MANUAL.md handoff (E-7). Status: done. Blocked-by: sgr103. Parallel-safe with sgr104/sgr105/sgr106. PR: https://github.com/LeoTheMighty/devx/pull/117 (merged 119f933)
- [x] `dev/dev-sgrret-2026-08-02T14:00-retro-story-graph.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: sgr101, sgr102, sgr103, sgr104, sgr105, sgr106, sgr107. PR: https://github.com/LeoTheMighty/devx/pull/121 (merged 8eb64bf)

### Epic — usage-window-governor (plan: c8e2d4)

`devx loop` pauses on the Claude subscription usage limit and auto-resumes
when the window resets, instead of misclassifying it as a hard error and
burning the abandon counter. Workstream
`_devx/workstreams/usage-window-governor/`; all four gates passed
2026-08-21 (design + plan + evals CONCERNS — the human-gated E-7 and the
parked FR-8 spike, recorded rather than waived). Design decision **D-UW1**:
the governor is a PRE-LADDER interception, not a ladder rung —
`ladder.ts` gets zero diff. Deps: uwg101 → uwg102 → uwg103 → uwg104;
uwgspk is parallel-safe with all of them.

- [x] `dev/dev-uwg101-2026-08-21T14:30-uwg101.md` — Detection floor: `usage-window.ts` markers, tail-bounded matcher, reset parsing. Ships inert (nothing calls it). Status: done. From: epic-usage-window-governor. PR: https://github.com/LeoTheMighty/devx/pull/142 (merged 868d647)
- [/] `dev/dev-uwg102-2026-08-21T14:30-uwg102.md` — Governor + driver seam: pure `planPause` + chunked `runPause`, intercepted before `classifyIteration` (D-UW1). Status: in-progress. Blocked-by: uwg101.
- [ ] `dev/dev-uwg103-2026-08-21T14:30-uwg103.md` — Pause is visible everywhere run state is: `LoopStatus "paused"`, gather liveness widening, `windowPauses[]`, morning-report section, four `loop:` knobs in config.ts AND the schema. Status: ready. Blocked-by: uwg102.
- [ ] `dev/dev-uwg104-2026-08-21T14:30-uwg104.md` — Live overnight ride-through. **HUMAN-GATED** — needs a supervised night riding a real reset; scoped alone so uwg101-103 ship green without it (the pin105 shape). Discharges MANUAL MV2.1. Status: ready. Blocked-by: uwg103.
- [ ] `dev/dev-uwgspk-2026-08-21T14:30-uwgspk.md` — Spike: does a usage-probe API exist at all? Findings doc only, timeboxed to one story. Parallel-safe with uwg101-104. Status: ready. From: epic-usage-window-governor.
- [ ] `dev/dev-uwgret-2026-08-21T13:14-retro-usage-window-governor.md` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: uwg101, uwg102, uwg103.

### Standalone — config/layout hygiene

- [ ] `dev/dev-lay101-2026-09-01T12:40-project-level-single-docset-guard.md` — Enforce `project-level`'s one-doc-set rule at the config seam (`devx workstream new` refusal + a `devx doctor` finding, one shared predicate). Replaces the `/devx-personalize` refusal that lost its home when the layout moved from the preference bank to `engine.docs_layout`. Status: ready. Blocked-by: —.

### Workstream: docs-layout-resolution (`plan/plan-a494be-...`)

`engine.docs_layout` is a config key that nothing meaningful reads: two
documents claim it selects where every engine artifact lives, and no code
implements that claim. Seven layered phases put ONE `(layout, base, kind)`
decision behind every artifact path, then make the docs true. Workstream
`_devx/workstreams/docs-layout-resolution/`; all four gates passed
(prd + design + plan + evals, 2026-09-02). devx itself stays on `workstream`
layout — every phase is a runtime no-op for it. Waves: dlr101 -> {dlr102,
dlr103} -> dlr104 -> dlr105 -> {dlr106, dlr107}.

- [x] `dev/dev-dlr101-2026-09-02T09:14-artifact-map-single-reader.md` — Docs layout resolution phase 1: the artifact map and the single layout reader — `ArtifactKind` + `stageSubject()` + `pathToArtifactKind()`, `resolveDocsLayout()` as the ONE reader, `docsLayout`/`layoutSource` on `EngineConfig` above both guards. Additive in production; re-types 8 test literals. Blocked-by: —. Status: done. PR: https://github.com/LeoTheMighty/devx/pull/151 (merged ef3e3f5)
- [x] `dev/dev-dlr102-2026-09-02T09:14-gate-subject-resolution.md` — Docs layout resolution phase 2: gate subject resolution — the 12 `commands/gate.ts` subject reads, `gate-prd.ts`'s 19 `location:` + 6 `message:` fields, `gate-coverage.ts` refusal strings. 8 layout x gate combinations, 0 verdict differences, pinned absolutely so mutual failure cannot pass. Blocked-by: dlr101. Parallel-safe with dlr103. Status: done. PR: https://github.com/LeoTheMighty/devx/pull/152 (merged 3e61e67)
- [/] `dev/dev-dlr103-2026-09-02T09:14-workstream-resolution-flat-guard.md` — Docs layout resolution phase 3: workstream resolution reaches the repo root under project-level (3 frontmatter states), `planFilenameWorkstreamRel()` re-signatured, the one flat-era guard that genuinely misfires discriminated, `layout-tree-mismatch` doctor finding. Ships no new user-reachable state (R-2). Blocked-by: dlr101. Parallel-safe with dlr102. Status: in-progress.
- [ ] `dev/dev-dlr104-2026-09-02T09:14-consumer-sweep-scaffolding.md` — Docs layout resolution phase 4: the consumer sweep (ten `*Abs()` helpers over the resolved base, 21 call sites, every hand-join closed, `devx next` probes) plus layout-aware scaffolding with the slug optional. E-3's scan is authored FIRST and negative-controlled against the live sites (R-6). No compile break. Blocked-by: dlr102, dlr103. Status: ready.
- [ ] `dev/dev-dlr105-2026-09-02T09:14-identity-rekey-privatization.md` — Docs layout resolution phase 5: `CASCADE_TABLE` re-keyed on `ArtifactKind`, `*_REL` + `artifactAbs` made private, orphaned resolvers deleted. THE RISKIEST PHASE — the only compile-breaking one, and where R-1 and R-4 live. Blocked-by: dlr104. Status: ready.
- [ ] `dev/dev-dlr106-2026-09-02T09:14-layout-migrate.md` — Docs layout resolution phase 6: `devx layout migrate --to <layout> [--dry-run]` — pure `MovePlan` planner, `git mv` executor, 3 refusals computed before any move, no `--force`. NOT REVERT-SAFE for a repo that ran it (R-5); G-3's real evidence is MANUAL.md MV-a494be.1 on ClassyLights. Blocked-by: dlr105. Parallel-safe with dlr107. Status: ready.
- [ ] `dev/dev-dlr107-2026-09-02T09:14-doc-truth.md` — Docs layout resolution phase 7: doc truth — CONFIG.md's artifact table restructured to one row per `ArtifactKind` (13 rows; the 13-row set-equality is the RED-bearing half), the schema description rewritten, and a follow-up filed for the nine skill-body path references. Blocked-by: dlr105. Parallel-safe with dlr106. Status: ready.
- [ ] `dev/dev-dlrret-2026-09-02T09:18-retro-docs-layout-resolution.md` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: dlr101, dlr102, dlr103, dlr104, dlr105, dlr106, dlr107.

# DEV — Features to build

Backlog for `/dev` to pick up. Each entry points at a spec file under `dev/`.

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

## Mobile companion v0.1 (plan: plan-7a2d1f)

### Epic 1 — Flutter scaffold & iOS on device (M1)
- [ ] `dev/dev-a10001-2026-04-23T13:01-flutter-project-scaffold.md` — Flutter project scaffold + nav shell. Status: ready. From: epic-flutter-scaffold-ios-device.
- [ ] `dev/dev-a10002-2026-04-23T13:02-riverpod-theme-router.md` — Riverpod + Material 3 theme + go_router foundations. Status: ready. Blocked-by: a10001.
- [ ] `dev/dev-a10003-2026-04-23T13:03-ios-project-config.md` — iOS project configuration (bundle ID, signing, push capability). Status: ready. Blocked-by: a10001. Requires user action (Team ID).
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
- [ ] `dev/dev-d40ret-2026-04-27T08:00-retro-realtime-updates-push.md` — Retro + LEARN.md updates (interim, per ROADMAP.md locked decision). Status: ready. Blocked-by: d40001, d40002, d40003, d40004, d40005, d40006.

## Phase 1 — Single-agent core loop (plan: plan-b01000)

### Epic 1 — Mode-derived merge gate (renamed from epic-promotion-gate-yolo-beta)
- [x] `dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md` — mergeGateFor() pure function + truth-table tests. Status: done. From: epic-merge-gate-modes. PR: https://github.com/LeoTheMighty/devx/pull/31 (merged 48cbd2f).
- [x] `dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md` — devx merge-gate <hash> CLI passthrough + /devx Phase 8 integration. Status: done. Blocked-by: mrg101. PR: https://github.com/LeoTheMighty/devx/pull/32 (merged dc86eb7).
- [x] `dev/dev-mrg103-2026-04-28T19:30-promote-integration.md` — Develop→main promotion code path (latent / dead-code-until-split-branch). Status: done. Blocked-by: mrg101. PR: https://github.com/LeoTheMighty/devx/pull/33 (merged 937624e).
- [x] `dev/dev-mrgret-2026-04-28T19:30-retro-merge-gate-modes.md` — Retro + LEARN.md updates (interim retro discipline). Status: done. Blocked-by: mrg101, mrg102, mrg103. PR: https://github.com/LeoTheMighty/devx/pull/34 (merged 34a605b). Closes epic-merge-gate-modes 4/4.

### Epic 2 — PR template (spec link as first line + Mode stamp)
- [/] `dev/dev-prt101-2026-04-28T19:30-pr-template-init-write.md` — Template ships + /devx-init writes it idempotently. Status: in-progress. From: epic-pr-template.
- [ ] `dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md` — /devx Phase 7 reads template + substitutes mode + spec path. Status: ready. Blocked-by: prt101.
- [ ] `dev/dev-prtret-2026-04-28T19:30-retro-pr-template.md` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: prt101, prt102.

### Epic 3 — /devx-plan skill (canonical PlanAgent)
- [ ] `dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md` — deriveBranch() helper + devx plan-helper derive-branch CLI. Status: ready. From: epic-devx-plan-skill.
- [ ] `dev/dev-pln102-2026-04-28T19:30-plan-emit-retro.md` — emitRetroStory() helper + retro-row co-emission discipline. Status: ready. Blocked-by: pln101.
- [ ] `dev/dev-pln103-2026-04-28T19:30-plan-validate-emit.md` — devx plan-helper validate-emit cross-reference checker. Status: ready. Blocked-by: pln101, pln102.
- [ ] `dev/dev-pln104-2026-04-28T19:30-plan-precedence-enforcement.md` — Source-of-truth-precedence enforcement at planning time. Status: ready. Blocked-by: pln103.
- [ ] `dev/dev-pln105-2026-04-28T19:30-plan-mode-gate.md` — Phase 6.5 mode gate is structurally explicit. Status: ready. Blocked-by: pln103.
- [ ] `dev/dev-pln106-2026-04-28T19:30-plan-summary-format.md` — Phase 8 final-summary Next command block format. Status: ready. Blocked-by: pln102.
- [ ] `dev/dev-plnret-2026-04-28T19:30-retro-devx-plan-skill.md` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: pln101, pln102, pln103, pln104, pln105, pln106.

### Epic 4 — /devx skill (canonical DevAgent)
- [ ] `dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md` — Atomic claim + push-before-PR + spec lock. Status: ready. From: epic-devx-skill. Blocked-by: mrg102, prt102.
- [ ] `dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md` — Conditional bmad-create-story with canary flag. Status: ready. Blocked-by: dvx101.
- [ ] `dev/dev-dvx103-2026-04-28T19:30-devx-self-review-discipline.md` — Phase 4 self-review status-log assertion. Status: ready. Blocked-by: dvx102.
- [ ] `dev/dev-dvx104-2026-04-28T19:30-devx-coverage-gate.md` — Mode-derived coverage gate (Phase 5). Status: ready. Blocked-by: dvx101.
- [ ] `dev/dev-dvx105-2026-04-28T19:30-devx-await-remote-ci.md` — Three-state remote-CI probe + ScheduleWakeup polling. Status: ready. Blocked-by: dvx101.
- [ ] `dev/dev-dvx106-2026-04-28T19:30-devx-auto-merge-gate.md` — Phase 8 auto-merge wired through devx merge-gate. Status: ready. Blocked-by: dvx101, mrg102.
- [ ] `dev/dev-dvx107-2026-04-28T19:30-devx-stop-after-handoff.md` — stop_after handling + Handoff Snippet on early stop. Status: ready. Blocked-by: dvx106.
- [ ] `dev/dev-dvxret-2026-04-28T19:30-retro-devx-skill.md` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: dvx101, dvx102, dvx103, dvx104, dvx105, dvx106, dvx107.

### Epic 5 — /devx-manage v0 (minimal scheduler + supervisor)
- [ ] `dev/dev-mgr101-2026-04-28T19:30-manage-scaffold.md` — Manager scaffold + devx manage --once single-tick CLI. Status: ready. From: epic-devx-manage-minimal. Blocked-by: dvxret.
- [ ] `dev/dev-mgr102-2026-04-28T19:30-manage-state-files.md` — State persistence: schedule.json + manager.json + heartbeat.json with atomic writes. Status: ready. Blocked-by: mgr101.
- [ ] `dev/dev-mgr103-2026-04-28T19:30-manage-reconcile.md` — Reconcile loop: read backlogs + compute diff + detect unblocks. Status: ready. Blocked-by: mgr102.
- [ ] `dev/dev-mgr104-2026-04-28T19:30-manage-spawn-worker.md` — Spawn one worker (hard cap N=1) + claude /devx <hash> subprocess. Status: ready. Blocked-by: mgr103.
- [ ] `dev/dev-mgr105-2026-04-28T19:30-manage-crash-restart.md` — Plain-crash restart logic + max-restarts-per-spec gate. Status: ready. Blocked-by: mgr104.
- [ ] `dev/dev-mgr106-2026-04-28T19:30-manage-lock-heartbeat.md` — Manager lock + heartbeat + SIGTERM-clean. Status: ready. Blocked-by: mgr101.
- [ ] `dev/dev-mgrret-2026-04-28T19:30-retro-devx-manage-minimal.md` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: mgr101, mgr102, mgr103, mgr104, mgr105, mgr106.

# DEV — Features to build

Backlog for `/dev` to pick up. Each entry points at a spec file under `dev/`.

## Phase 0 — Foundation (plan: plan-a01000)

### Epic 1 — BMAD audit
- [x] `dev/dev-aud101-2026-04-26T19:35-bmad-modules-inventory.md` — Inventory BMAD modules + workflows. Status: done. From: epic-bmad-audit. PR: https://github.com/LeoTheMighty/devx/pull/1 (merged 70872e4).
- [ ] `dev/dev-aud102-2026-04-26T19:35-bmad-classify-workflows.md` — Classify each BMAD workflow + map to devx command. Status: ready. Blocked-by: aud101.
- [ ] `dev/dev-aud103-2026-04-26T19:35-bmad-risks-finalize.md` — Risks subsection + finalize bmad-audit.md. Status: ready. Blocked-by: aud102.

### Epic 2 — devx.config.yaml schema + CLI
- [ ] `dev/dev-cfg201-2026-04-26T19:35-config-schema-json.md` — JSON schema for all 15 sections of devx.config.yaml. Status: ready. From: epic-config-schema.
- [ ] `dev/dev-cfg202-2026-04-26T19:35-config-yaml-roundtrip-lib.md` — YAML round-trip lib using eemeli/yaml. Status: ready.
- [ ] `dev/dev-cfg203-2026-04-26T19:35-config-validation-on-load.md` — Config validation on load. Status: ready. Blocked-by: cfg201, cfg202.
- [ ] `dev/dev-cfg204-2026-04-26T19:35-config-cli-get-set.md` — `devx config <key>` get/set CLI. Status: ready. Blocked-by: cfg202, cfg203, cli301.

### Epic 3 — devx CLI skeleton
- [ ] `dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md` — npm package scaffold + commander dispatch. Status: ready. From: epic-cli-skeleton.
- [ ] `dev/dev-cli302-2026-04-26T19:35-cli-stubs.md` — Stub helper + 10 stub commands registered. Status: ready. Blocked-by: cli301.
- [ ] `dev/dev-cli303-2026-04-26T19:35-cli-help-listing.md` — `devx --help` listing with phase + epic annotations. Status: ready. Blocked-by: cli302, cfg204.
- [ ] `dev/dev-cli304-2026-04-26T19:35-cli-version-postinstall.md` — `devx --version` + postinstall PATH verification. Status: ready. Blocked-by: cli301.
- [ ] `dev/dev-cli305-2026-04-26T19:35-cli-cross-platform-install.md` — Cross-platform install + WSL PATH detection. Status: ready. Blocked-by: cli304.

### Epic 4 — OS supervisor scaffold
- [ ] `dev/dev-sup401-2026-04-26T19:35-supervisor-stub-script.md` — Supervisor stub script + idempotent install. Status: ready. From: epic-os-supervisor-scaffold. Blocked-by: cli301.
- [ ] `dev/dev-sup402-2026-04-26T19:35-supervisor-launchd.md` — macOS launchd plist generator + bootstrap. Status: ready. Blocked-by: sup401.
- [ ] `dev/dev-sup403-2026-04-26T19:35-supervisor-systemd.md` — Linux systemd-user .service generator + enable. Status: ready. Blocked-by: sup401.
- [ ] `dev/dev-sup404-2026-04-26T19:35-supervisor-task-scheduler.md` — Windows/WSL Task Scheduler XML generator. Status: ready. Blocked-by: sup401.
- [ ] `dev/dev-sup405-2026-04-26T19:35-supervisor-platform-detect.md` — Platform auto-detect dispatch + post-install verification. Status: ready. Blocked-by: sup402, sup403, sup404.

### Epic 5 — `/devx-init` skill
- [ ] `dev/dev-ini501-2026-04-26T19:35-init-question-flow.md` — 13-question flow + skip-table inference + state detection. Status: ready. From: epic-init-skill. Blocked-by: aud103, cli301.
- [ ] `dev/dev-ini502-2026-04-26T19:35-init-local-writes.md` — Local file writes (config + backlogs + spec dirs + CLAUDE.md + .gitignore). Status: ready. Blocked-by: ini501, cfg204.
- [ ] `dev/dev-ini503-2026-04-26T19:35-init-github-scaffolding.md` — GitHub-side scaffolding (workflows + PR template + develop + protection). Status: ready. Blocked-by: ini502.
- [ ] `dev/dev-ini504-2026-04-26T19:35-init-personas-and-interview.md` — Personas + INTERVIEW.md fixed-template seeding. Status: ready. Blocked-by: ini502.
- [ ] `dev/dev-ini505-2026-04-26T19:35-init-supervisor-trigger.md` — Supervisor installer trigger + verify. Status: ready. Blocked-by: ini502, sup405.
- [ ] `dev/dev-ini506-2026-04-26T19:35-init-failure-modes.md` — Failure-mode handling (BMAD-fail / gh-not-auth / no-remote). Status: ready. Blocked-by: ini503, ini505.
- [ ] `dev/dev-ini507-2026-04-26T19:35-init-idempotent-upgrade.md` — Idempotent upgrade-mode re-run. Status: ready. Blocked-by: ini502, ini503, ini504, ini505.
- [ ] `dev/dev-ini508-2026-04-26T19:35-init-end-to-end-test.md` — End-to-end integration test. Status: ready. Blocked-by: ini506, ini507.

## Mobile companion v0.1 (plan: plan-7a2d1f)

### Epic 1 — Flutter scaffold & iOS on device (M1)
- [ ] `dev/dev-a10001-2026-04-23T13:01-flutter-project-scaffold.md` — Flutter project scaffold + nav shell. Status: ready. From: epic-flutter-scaffold-ios-device.
- [ ] `dev/dev-a10002-2026-04-23T13:02-riverpod-theme-router.md` — Riverpod + Material 3 theme + go_router foundations. Status: ready. Blocked-by: a10001.
- [ ] `dev/dev-a10003-2026-04-23T13:03-ios-project-config.md` — iOS project configuration (bundle ID, signing, push capability). Status: ready. Blocked-by: a10001. Requires user action (Team ID).
- [ ] `dev/dev-a10004-2026-04-23T13:04-first-ondevice-run.md` — First on-device run. Status: ready. Blocked-by: a10002, a10003. Requires user action (plug in phone).
- [ ] `dev/dev-a10005-2026-04-23T13:05-testflight-pipeline.md` — TestFlight pipeline. Status: ready. Blocked-by: a10004. Requires user action (App Store Connect upload).

### Epic 2 — GitHub connection read (M2)
- [ ] `dev/dev-b20001-2026-04-23T13:10-auth-service-onboarding.md` — Auth service + PAT onboarding screen. Status: ready. Blocked-by: a10005.
- [ ] `dev/dev-b20002-2026-04-23T13:11-github-client-wrapper.md` — GitHub client wrapper + Contents read client. Status: ready. Blocked-by: b20001.
- [ ] `dev/dev-b20003-2026-04-23T13:12-backlog-parser.md` — Backlog markdown → structured model parser. Status: ready. Blocked-by: b20002.
- [ ] `dev/dev-b20004-2026-04-23T13:13-inbox-tab.md` — Inbox tab — INTERVIEW + MANUAL + open PRs. Status: ready. Blocked-by: b20003.
- [ ] `dev/dev-b20005-2026-04-23T13:14-backlogs-tab-spec-detail.md` — Backlogs tab + spec detail view. Status: ready. Blocked-by: b20003.

### Epic 3 — Bidirectional writes + offline (M3)
- [ ] `dev/dev-c30001-2026-04-23T13:20-offline-queue-drift.md` — Offline queue foundation. Status: ready. Blocked-by: b20005.
- [ ] `dev/dev-c30002-2026-04-23T13:21-git-data-api-client.md` — Git Data API client (atomic multi-file commit). Status: ready. Blocked-by: b20002.
- [ ] `dev/dev-c30003-2026-04-23T13:22-add-tab-plus-button.md` — Add tab — (+) button flow. Status: ready. Blocked-by: c30001, c30002.
- [ ] `dev/dev-c30004-2026-04-23T13:23-inline-interview-answer.md` — Inline INTERVIEW answering. Status: ready. Blocked-by: c30001, b20004.
- [ ] `dev/dev-c30005-2026-04-23T13:24-conflict-resolution-ui.md` — Conflict resolution UI. Status: ready. Blocked-by: c30003, c30004.

### Epic 4 — Real-time updates (M4)
- [ ] `dev/dev-d40001-2026-04-23T13:30-cloudflare-worker-scaffold.md` — Cloudflare Worker scaffold + HMAC verification. Status: ready. Blocked-by: c30005.
- [ ] `dev/dev-d40002-2026-04-23T13:31-fcm-sender.md` — FCM sender + service-account JWT auth. Status: ready. Blocked-by: d40001. Requires user action (Firebase project).
- [ ] `dev/dev-d40003-2026-04-23T13:32-event-filters-fanout.md` — Event filters + fanout to device tokens. Status: ready. Blocked-by: d40002.
- [ ] `dev/dev-d40004-2026-04-23T13:33-device-registration.md` — Device registration + deregistration endpoints. Status: ready. Blocked-by: d40001.
- [ ] `dev/dev-d40005-2026-04-23T13:34-flutter-fcm-integration.md` — Flutter firebase_messaging integration. Status: ready. Blocked-by: d40004. Requires user action (GoogleService-Info.plist).
- [ ] `dev/dev-d40006-2026-04-23T13:35-deep-linking-inline-reply.md` — Deep-linking + iOS inline-reply. Status: ready. Blocked-by: d40005.
- [ ] `dev/dev-d40007-2026-04-23T13:36-laptop-fastpath-webhook.md` — Laptop-side fast-path webhook receiver. Status: ready. Blocked-by: d40003. Optional.

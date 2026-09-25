---
hash: b20001
type: dev
created: 2026-04-23T13:10:00-07:00
title: Auth service + PAT onboarding screen
from: _bmad-output/planning-artifacts/epic-github-connection-read.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: deleted
branch: develop/dev-b20001
blocked_by: [a10005]
---

## Goal
First-run onboarding captures a fine-grained PAT and target repo. Stores PAT securely. Validates by calling `GET /user` and `GET /repos/<owner>/<name>`.

## Acceptance criteria
- [ ] `flutter_secure_storage` stores + retrieves PAT under key `github_pat`
- [ ] Onboarding screen: obscured PAT field, repo field (`owner/name`), "Connect" button
- [ ] On submit, calls `GET /user` + `GET /repos/<owner>/<name>`; on 401 shows "invalid token"; on 404 shows "repo not found or no access"
- [ ] On success, stores PAT + repo, navigates to Inbox
- [ ] Biometric gate (via `local_auth`) added as settings toggle; default OFF for v0.1
- [ ] Widget tests cover the 3 outcome paths

## Technical notes
- PAT is sensitive; never log, never include in crash reports
- Config persisted separately (not in secure storage — repo name isn't secret)

## Status log
- 2026-04-23T13:10 — created by /dev-plan

## Files expected
- `mobile/pubspec.yaml` (+flutter_secure_storage, +local_auth, +dio, +github)
- `mobile/lib/core/auth/auth_service.dart`
- `mobile/lib/core/auth/providers.dart`
- `mobile/lib/features/onboarding/onboarding_screen.dart`
- `mobile/lib/features/onboarding/onboarding_controller.dart`
- `mobile/test/features/onboarding_test.dart`
- 2026-09-25T10:30-06:00 — retired with the mobile companion (D-16, `plan-47b842`). Leo's decision: the app never went past a scaffold, the Worker relay was never written, and the backlog had said PAUSED for five months. Spec kept for audit; `mobile/` and `docs/MOBILE.md` are deleted in the same PR.

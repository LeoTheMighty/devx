---
hash: d40005
type: dev
created: 2026-04-23T13:34:00-07:00
title: Flutter firebase_messaging integration + token registration
from: _bmad-output/planning-artifacts/epic-realtime-updates-push.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-d40005
blocked_by: [d40004]
requires_user_action: true
---

## Goal
Wire `firebase_messaging` + `firebase_core` into the Flutter app. Request notification permission on first run, receive FCM token, register with Worker. Handle foreground + background push receipt.

## Acceptance criteria
- [ ] User adds `GoogleService-Info.plist` (iOS) — MANUAL.md item blocks until done
- [ ] `firebase_core.initializeApp()` runs at app start
- [ ] After onboarding, request notification permission; on grant, retrieve FCM token, POST to `<worker_url>/devices/register`
- [ ] Token refresh listener re-registers on change
- [ ] Foreground push shows an in-app banner via `awesome_notifications` or built-in
- [ ] Background push pre-populates deep-link target; app navigates on tap
- [ ] Widget tests mock `FirebaseMessaging` and cover permission granted + denied paths

## Technical notes
- Firebase dependencies pin to Firebase v14+
- `firebase_messaging.onBackgroundMessage` must be a top-level function, not a method
- Worker URL comes from `devx.config.yaml → mobile.worker_url` (TBD — stored in app prefs after onboarding)

## Status log
- 2026-04-23T13:34 — created by /dev-plan

## Files expected
- `mobile/pubspec.yaml` (+firebase_core, +firebase_messaging)
- `mobile/ios/Runner/GoogleService-Info.plist` (user-provided, gitignored)
- `mobile/lib/core/push/push_service.dart`
- `mobile/lib/core/push/notification_handler.dart`
- `mobile/lib/main.dart` (update)
- `mobile/test/core/push/push_service_test.dart`

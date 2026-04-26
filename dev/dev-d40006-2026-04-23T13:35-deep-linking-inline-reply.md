---
hash: d40006
type: dev
created: 2026-04-23T13:35:00-07:00
title: Deep-linking + iOS inline-reply notification action
from: _bmad-output/planning-artifacts/epic-realtime-updates-push.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-d40006
blocked_by: [d40005]
---

## Goal
Tapping a notification opens the correct screen with the right item focused. For INTERVIEW pushes, iOS inline-reply lets the user answer without opening the app.

## Acceptance criteria
- [ ] Notification payload's `deep_link` field is parsed by `DeepLinker.routeFromPayload()`
- [ ] Supported targets: `/inbox/interview/<hash>`, `/inbox/manual/<hash>`, `/backlogs/<type>`, `/pr/<number>` (webview)
- [ ] On cold start from notification tap: app opens, routes to target, focuses the relevant item
- [ ] iOS inline-reply: `UNNotificationAction` registered for `interview` category; tapping "Reply" shows inline text input; submitting calls `ContentsWriter.updateFile` via Contents API without opening the app
- [ ] Badge count updates based on INTERVIEW + MANUAL item counts
- [ ] Widget test covers payload parsing; manual device test for inline-reply

## Technical notes
- iOS inline-reply requires notification categories in `AppDelegate.swift` — must edit native code
- Android equivalent uses `RemoteInput` but not in v0.1 scope
- Badge counts: total unanswered INTERVIEW + unchecked MANUAL items from the last fetch

## Status log
- 2026-04-23T13:35 — created by /dev-plan

## Files expected
- `mobile/lib/core/push/deep_linker.dart`
- `mobile/ios/Runner/AppDelegate.swift` (edit for notification categories)
- `mobile/lib/features/inbox/inline_reply_handler.dart`
- `mobile/test/core/push/deep_linker_test.dart`

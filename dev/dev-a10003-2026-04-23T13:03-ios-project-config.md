---
hash: a10003
type: dev
created: 2026-04-23T13:03:00-07:00
title: iOS project configuration (bundle ID, signing, push capability)
from: _bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: deleted
branch: develop/dev-a10003
blocked_by: [a10001]
requires_user_action: true
---

## Goal
Configure the iOS project under `mobile/ios/` with Leonid's Team ID, a registered App ID with Push Notifications capability, and automatic signing for dev + manual signing for release.

## Acceptance criteria
- [ ] App ID registered in Apple Developer portal with Push Notifications capability
- [ ] Bundle ID locked (e.g., `com.leonidbelyi.devx`) — updates `mobile/ios/Runner.xcodeproj/project.pbxproj` accordingly
- [ ] Automatic signing for Debug builds on Leonid's development device
- [ ] Distribution signing configured for Release
- [ ] `Info.plist` has `CFBundleDisplayName: devx`, placeholder usage descriptions for camera/biometrics/network (even if unused in E1 — avoids regressions later)
- [ ] `docs/ios-signing-troubleshooting.md` documents common failures (expired provisioning profile, device not registered, Team ID mismatch)

## Technical notes
- User must provide Team ID — file `MANUAL.md` item at start: "Share Apple Developer Team ID"
- User must register Leonid's iPhone UDID in the Developer portal
- Push Notifications capability enabled now even though unused in E1 (cheaper than retrofitting)

## Status log
- 2026-04-23T13:03 — created by /dev-plan — filed MANUAL.md entry for Team ID
- 2026-07-15T12:30 — marked blocked by /devx: core ACs (Team ID in pbxproj, App ID registration, signing) require MANUAL.md M1.1 (Share Apple Developer Team ID), still unchecked; not claimable until the user provides it

## Files expected
- `mobile/ios/Runner.xcodeproj/project.pbxproj` (bundle ID, Team ID)
- `mobile/ios/Runner/Info.plist`
- `mobile/ios/Runner/Runner.entitlements` (push capability)
- `docs/ios-signing-troubleshooting.md`
- 2026-09-25T10:30-06:00 — retired with the mobile companion (D-16, `plan-47b842`). Leo's decision: the app never went past a scaffold, the Worker relay was never written, and the backlog had said PAUSED for five months. Spec kept for audit; `mobile/` and `docs/MOBILE.md` are deleted in the same PR.

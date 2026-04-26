---
hash: a10005
type: dev
created: 2026-04-23T13:05:00-07:00
title: TestFlight pipeline (archive + upload + install)
from: _bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-a10005
blocked_by: [a10004]
requires_user_action: true
---

## Goal
Produce a signed `.xcarchive`, upload to App Store Connect, and get the build visible in TestFlight on Leonid's phone for one-tap install.

## Acceptance criteria
- [ ] `xcodebuild archive` produces a valid `.xcarchive` under `build/`
- [ ] Xcode Organizer uploads to App Store Connect (or `fastlane pilot` equivalent)
- [ ] Build appears in TestFlight within 20 minutes of upload
- [ ] Leonid installs via TestFlight and launches successfully from his home screen
- [ ] `mobile/SHIP_IOS.md` documents the repeatable flow (version bump, archive, upload, wait, install)
- [ ] Optional fastlane setup captured but deferred if manual flow suffices

## Technical notes
- Version scheme: semantic `X.Y.Z` + build number. First build: `0.1.0+1`.
- TestFlight compliance questions: "Does this app use encryption?" — Yes (HTTPS). "Is it exempt?" — Yes (standard uses).
- App Store Connect API key can be used to automate but not required for v0.1

## Status log
- 2026-04-23T13:05 — created by /dev-plan — Milestone M1 target

## Files expected
- `mobile/SHIP_IOS.md`
- No code changes; this is a shipping story
- Optionally: `mobile/fastlane/Fastfile`, `mobile/fastlane/Appfile` if fastlane path is chosen

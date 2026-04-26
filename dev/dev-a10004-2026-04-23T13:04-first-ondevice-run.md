---
hash: a10004
type: dev
created: 2026-04-23T13:04:00-07:00
title: First on-device run (plugged-in iPhone)
from: _bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-a10004
blocked_by: [a10002, a10003]
requires_user_action: true
---

## Goal
Get the app running on Leonid's iPhone via `flutter run` over USB. The 4-tab shell must launch, be interactive, and persist after the debug session ends.

## Acceptance criteria
- [ ] `flutter devices` lists Leonid's iPhone
- [ ] `flutter run -d <iphone-id>` succeeds; shell appears and is responsive
- [ ] App survives hot-restart and hot-reload cycles
- [ ] After stopping the debug session, the app still launches standalone from the home screen for at least the provisioning-profile validity window (7 days)
- [ ] Any signing or capability failures get logged into `docs/ios-signing-troubleshooting.md` with their resolution

## Technical notes
- User plugs in iPhone with cable trusted
- May require "Trust this computer" on first connection
- First build is slow (~5 min); subsequent builds much faster

## Status log
- 2026-04-23T13:04 — created by /dev-plan

## Files expected
- No code changes; this story is a smoke-test story
- Possibly updates to `docs/ios-signing-troubleshooting.md` if issues found

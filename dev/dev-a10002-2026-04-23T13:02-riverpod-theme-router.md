---
hash: a10002
type: dev
created: 2026-04-23T13:02:00-07:00
title: Riverpod + Material 3 theme + go_router foundations
from: _bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-a10002
blocked_by: [a10001]
---

## Goal
Wire `ProviderScope`, Material 3 theme (light/dark), and `go_router` for the 4 tabs. Every tap navigates to the correct screen; each screen renders its placeholder "Coming in <epic>" copy.

## Acceptance criteria
- [ ] `ProviderScope` wraps the root widget
- [ ] Material 3 theme defined in `lib/shared/theme.dart`; respects system light/dark
- [ ] `go_router` config with 4 named routes + error page; reachable via BottomNavigationBar taps
- [ ] Each tab's placeholder screen renders a title + "Coming in E2/E3/E4" text
- [ ] Widget tests verify: tab tap navigates, back nav preserves scroll, theme toggles

## Technical notes
- Use `Theme.of(context).colorScheme` everywhere; no hardcoded colors
- Router uses shell route for AppShell; nested routes land under each tab
- Providers live in `lib/core/providers.dart`

## Status log
- 2026-04-23T13:02 — created by /dev-plan

## Files expected
- `mobile/lib/core/router.dart`
- `mobile/lib/core/providers.dart`
- `mobile/lib/shared/theme.dart`
- `mobile/lib/shared/app_shell.dart` (refined)
- `mobile/lib/features/*/screen.dart` (placeholders updated)
- `mobile/test/navigation_test.dart`

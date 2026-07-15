---
hash: a10002
type: dev
created: 2026-04-23T13:02:00-07:00
title: Riverpod + Material 3 theme + go_router foundations
from: _bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: done
owner: /devx-2026-07-15T1127-76887
branch: feat/dev-a10002
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
- 2026-07-15T11:27:49-06:00 — claimed by /devx in session /devx-2026-07-15T1127-76887
- 2026-07-15T11:55 — phase 2: spec ACs direct (v2 native); 5 ACs; workstream=none; red-artifacts=none; tab→epic copy mapping: Inbox+Backlogs=E2 github-connection-read, Add=E3 bidirectional-writes-offline, Activity=E4 realtime-updates-push (per docs/MOBILE.md screen table)
- 2026-07-15T12:05 — phase 3: go_router 16.3.0 StatefulShellRoute.indexedStack (4 branches, named routes, error page) + theme.dart (M3 seeded light/dark) + providers.dart (themeModeProvider, routerProvider) + AppShell router-driven + ComingSoonList placeholder body + navigation_test.dart (5 tests); router is provider-backed (fresh per ProviderScope) so widget tests do not share navigation state
- 2026-07-15T12:10 — phase 4: 1-agent single-pass review (~450 hand-authored LoC; below 3-agent threshold); 1 finding (0 HIGH, 0 MED, 1 LOW); ALL fixed in-place — mobile/README.md still pointed theme/router at a10002 and omitted new files from the layout; re-review clean
- 2026-07-15T12:12 — phase 5: local CI green — flutter analyze clean, flutter test 7/7 (2 smoke + 5 navigation), coverage 97.7% (informational, YOLO)
- 2026-07-15T12:20 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/77; phase 7.5: tour published https://htmlpreview.github.io/?https://raw.githubusercontent.com/LeoTheMighty/devx/devx-tours/tours/a10002/tour.html
- 2026-07-15T12:22 — merged via PR #77 (squash → b0223bd); remote CI devx-ci success; check-hold clean; merge-gate {"merge":true}

## Files expected
- `mobile/lib/core/router.dart`
- `mobile/lib/core/providers.dart`
- `mobile/lib/shared/theme.dart`
- `mobile/lib/shared/app_shell.dart` (refined)
- `mobile/lib/features/*/screen.dart` (placeholders updated)
- `mobile/test/navigation_test.dart`

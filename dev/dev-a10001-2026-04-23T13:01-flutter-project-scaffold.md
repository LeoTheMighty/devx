---
hash: a10001
type: dev
created: 2026-04-23T13:01:00-07:00
title: Flutter project scaffold + nav shell
from: _bmad-output/planning-artifacts/epic-flutter-scaffold-ios-device.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-a10001
---

## Goal
Initialize the Flutter project under `mobile/` inside the devx repo with a 4-tab navigation shell, strict lints, and a smoke test.

## Acceptance criteria
- [ ] `flutter create mobile` completes with the bundle ID (placeholder until story a10003 locks the Team ID)
- [ ] `flutter run -d chrome` shows the 4-tab shell: Inbox / Backlogs / Add / Activity
- [ ] `flutter test` passes the smoke test (`app boots and renders 4 tabs`)
- [ ] `analysis_options.yaml` present with strict lints; `flutter analyze` clean
- [ ] `mobile/README.md` documents: how to run, required Flutter version, folder layout

## Technical notes
- Flutter version: `flutter --version` should be 3.x+ (check and document actual)
- Folder structure per epic file's "File structure" section
- Smoke test uses `flutter_test`'s `testWidgets` with a minimal `ProviderScope` wrap

## Status log
- 2026-04-23T13:01 — created by /dev-plan

## Files expected
- `mobile/pubspec.yaml`
- `mobile/analysis_options.yaml`
- `mobile/lib/main.dart`
- `mobile/lib/shared/app_shell.dart`
- `mobile/lib/features/{inbox,backlogs,add_item,activity}/` stubs
- `mobile/test/smoke_test.dart`
- `mobile/README.md`

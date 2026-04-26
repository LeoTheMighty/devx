<!-- refined: party-mode 2026-04-23 -->

# Epic — Flutter scaffold & iOS on device

**Plan:** `plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md`
**Slug:** `epic-flutter-scaffold-ios-device`
**Order:** 1 of 4
**User sees:** "My empty devx app is running on my iPhone."

## Overview
Stand up the Flutter project under `mobile/` inside the devx repo, configure iOS signing + push capability, and deliver a first TestFlight build installed on Leonid's iPhone. No GitHub integration yet — this epic's success is an empty nav shell opening on the real device.

## Goal
Prove the platform build pipeline and deliver an installable app to Leonid's phone as the foundation every subsequent epic builds on.

## End-user flow
1. Leonid runs `flutter create mobile` (or the spec file's equivalent command) in the devx repo.
2. He runs `flutter run` against his plugged-in iPhone — the empty devx shell appears with 4 tabs (Inbox / Backlogs / Add / Activity), each showing a placeholder.
3. He archives in Xcode and uploads to TestFlight.
4. Moments later, TestFlight on his phone shows a new build; he taps Install.
5. The app launches from his home screen, shows the 4-tab shell, and accepts touch without crashing.

## Frontend changes (Flutter)
- `mobile/` directory initialized via `flutter create` with org reverse-DNS bundle ID (`com.<org>.devx`).
- Folder structure: `lib/core/`, `lib/features/{inbox,backlogs,add_item,activity}/`, `lib/shared/`.
- Dependencies added to `pubspec.yaml`: `flutter_riverpod`, `flutter_markdown`, `go_router` (or comparable).
- App entry sets up `ProviderScope`, Material 3 theming (light/dark), and a `go_router` config with the 4 tab routes.
- `AppShell` widget in `lib/shared/` renders `BottomNavigationBar` with 4 tabs; each tab has a stub "coming in E2/E3/E4" screen.
- Baseline `analysis_options.yaml` with strict-mode lints.

## Backend changes
None — this epic is frontend + infra only.

## Infrastructure changes
- Apple Developer Team ID recorded in `mobile/ios/Runner.xcworkspace`.
- Bundle ID registered as an App ID in Apple Developer portal with Push Notifications capability enabled (even though E1 doesn't use it yet — cheaper to enable now).
- Automatic signing enabled for Debug; distribution signing configured for Release (TestFlight).
- `Info.plist` configured with display name, usage description strings (for later camera/biometrics features).
- Optional fastlane `Fastfile` for repeatable TestFlight uploads (or document manual Xcode archive flow).

## Design principles (from research)
- Multi-platform codebase from day one (iOS + Android + web scaffolded; only iOS shipped in v0.1).
- No state management beyond Riverpod. No custom service locators. Keep surfaces small.
- `mobile/` is its own Flutter project; not a sub-module. `cd mobile && flutter <cmd>` is the only invocation shape.
- Theming uses system dynamic type; do not hardcode font sizes.

## File structure
```
mobile/
├── pubspec.yaml
├── analysis_options.yaml
├── lib/
│   ├── main.dart                       ← entry + ProviderScope + theme + router
│   ├── core/
│   │   └── router.dart
│   ├── features/
│   │   ├── inbox/inbox_screen.dart     ← placeholder
│   │   ├── backlogs/backlogs_screen.dart
│   │   ├── add_item/add_item_screen.dart
│   │   └── activity/activity_screen.dart
│   └── shared/
│       ├── app_shell.dart              ← BottomNavigationBar wrapper
│       └── theme.dart
├── ios/
│   └── Runner.xcworkspace              ← signing, capabilities, bundle ID
├── android/                             ← scaffolded, not released
├── web/                                 ← scaffolded, not released
└── test/
    └── smoke_test.dart                  ← "app boots and renders the 4 tabs"
```

## Story list with ACs

### 1.1 Flutter project scaffold + nav shell
- [ ] `flutter create` completes under `mobile/` with the chosen bundle ID
- [ ] `flutter run -d chrome` boots and shows the 4-tab shell
- [ ] `flutter test` passes the smoke test
- [ ] `analysis_options.yaml` present with strict lints; `flutter analyze` clean

### 1.2 Riverpod + theme + router foundations
- [ ] `ProviderScope` wraps the app
- [ ] Material 3 theme defined; light/dark switch respects system
- [ ] `go_router` config with 4 named routes, reachable via tab taps
- [ ] Stub screen for each tab renders a title + "(placeholder — <epic>)" text

### 1.3 iOS project configuration
- [ ] Bundle ID registered in Apple Developer portal with Push Notifications capability
- [ ] Automatic signing working for Debug on a physical device plugged into Xcode
- [ ] Distribution signing configured for Release
- [ ] `Info.plist` has display name "devx", and placeholder usage description strings for later features

### 1.4 First on-device run
- [ ] `flutter run` against a plugged-in iPhone succeeds; shell visible
- [ ] App launches standalone from home screen after stopping the debug session

### 1.5 TestFlight pipeline
- [ ] `xcodebuild archive` produces a signed `.xcarchive`
- [ ] Upload to App Store Connect via Xcode Organizer (or fastlane)
- [ ] Build appears in TestFlight within 20 minutes; Leonid installs on his phone
- [ ] A `SHIP_IOS.md` doc (or similar) under `mobile/` captures the repeatable flow

## Dependencies
- **External:** Apple Developer Program account (already paid), Xcode ≥ 15.
- **Repo prerequisites:** none — this is the first epic. (Note: `develop` branch does not yet exist in the devx repo; `/dev` must create it on its first run. Flagged as an open question.)

## Open questions
1. **Branch setup.** `develop` doesn't exist yet — should E1.1's `/dev` run create it and set it as the default? Or should the user do it before `/dev` fires? Leaning: `/dev` creates it automatically on first run if absent.
2. **`fastlane` vs. manual Xcode flow.** YOLO: document the manual Xcode flow first, add fastlane later if iteration speed is painful.
3. **Org / Team ID.** Need Leonid's Apple Team ID to hardcode in the project config. Block: `MANUAL.md` question for the user.

## Milestone
**M1 — "Hello, iPhone."** Success = empty shell running on Leonid's phone.

## Party-mode critique (team lenses)

- **PM**: M1 is visibly "empty app on phone" — which is exactly the right scope. Delivers proof of pipeline, not product. Approve.
- **UX**: 4-tab shell must look competent even when empty. Each placeholder reads: "Coming in <epic>" — not "Not implemented." Empty states are themselves a surface.
- **Frontend (Flutter)**: Riverpod baseline + go_router + Material 3 is the least controversial stack. No concerns.
- **Backend**: N/A this epic.
- **Infrastructure**: Apple signing is the #1 source of first-time friction. Budget for 2–3 hours of "why is signing failing" pain in the first on-device attempt. Consider a `docs/ios-signing-troubleshooting.md` file with known failure modes.
- **QA**: Smoke test is sufficient. No need for integration tests yet — E2 introduces the first real behavior worth testing end-to-end.
- **Locked decisions fed forward**: bundle ID pattern; directory layout under `mobile/lib/`; Riverpod + go_router baseline; iOS signing doc lives under `docs/`.

## Focus-group reactions
Skipped — YOLO mode.

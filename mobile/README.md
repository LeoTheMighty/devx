# devx mobile companion

Flutter companion app for the devx autonomous development system. v0.1 scope:
inbox for INTERVIEW/MANUAL items, backlog browsing, quick-add, and an activity
feed. See `../docs/MOBILE.md` for the full contract.

## Requirements

- Flutter **3.38.x** (stable channel; built against 3.38.9 / Dart 3.10.8).
  Check with `flutter --version`.

## How to run

```sh
cd mobile
flutter pub get
flutter run -d chrome     # web (fastest for development)
flutter run               # any connected device / simulator
```

## Tests and lints

```sh
flutter test              # smoke test: app boots and renders 4 tabs
flutter analyze           # strict lints (see analysis_options.yaml)
```

## Folder layout

```
mobile/
├── pubspec.yaml
├── analysis_options.yaml    ← strict analyzer modes + lint rules
├── lib/
│   ├── main.dart             ← entry; ProviderScope + MaterialApp.router
│   ├── core/
│   │   ├── router.dart       ← go_router: shell route + 4 named routes + error page
│   │   └── providers.dart    ← themeModeProvider, routerProvider
│   ├── features/
│   │   ├── inbox/            ← Inbox tab (placeholder — E2)
│   │   ├── backlogs/         ← Backlogs tab (placeholder — E2)
│   │   ├── add_item/         ← Add tab (placeholder — E3)
│   │   └── activity/         ← Activity tab (placeholder — E4)
│   └── shared/
│       ├── app_shell.dart    ← 4-tab NavigationBar shell (router-driven)
│       ├── theme.dart        ← Material 3 light/dark (seeded ColorScheme)
│       └── coming_soon_list.dart ← shared placeholder list body
├── ios/ android/ web/ macos/ ← platform scaffolds (iOS is the release target)
└── test/
    ├── smoke_test.dart
    └── navigation_test.dart
```

## Notes

- Bundle ID is a placeholder (`org.ac93.devx`) until story a10003 locks iOS
  signing with the real Team ID.
- Riverpod is wired at the root (`ProviderScope`); Material 3 theme
  (light/dark, follows system via `themeModeProvider`) and go_router
  (StatefulShellRoute — per-tab stacks + scroll state survive tab switches)
  shipped in story a10002.

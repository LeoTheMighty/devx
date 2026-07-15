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
│   ├── main.dart             ← entry; ProviderScope + MaterialApp
│   ├── features/
│   │   ├── inbox/            ← Inbox tab (placeholder)
│   │   ├── backlogs/         ← Backlogs tab (placeholder)
│   │   ├── add_item/         ← Add tab (placeholder)
│   │   └── activity/         ← Activity tab (placeholder)
│   └── shared/
│       └── app_shell.dart    ← 4-tab NavigationBar shell
├── ios/ android/ web/ macos/ ← platform scaffolds (iOS is the release target)
└── test/
    └── smoke_test.dart
```

## Notes

- Bundle ID is a placeholder (`org.ac93.devx`) until story a10003 locks iOS
  signing with the real Team ID.
- Riverpod is wired at the root (`ProviderScope`); Material 3 theme +
  go_router foundations land in story a10002.

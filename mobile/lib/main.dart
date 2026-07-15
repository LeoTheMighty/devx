import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/providers.dart';
import 'shared/theme.dart';

void main() {
  runApp(const ProviderScope(child: DevxApp()));
}

/// Root widget for the devx mobile companion: Material 3 light/dark themes
/// (mode driven by [themeModeProvider], default follows the system) over the
/// go_router 4-tab shell.
class DevxApp extends ConsumerWidget {
  const DevxApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModeProvider);
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'devx',
      theme: buildLightTheme(),
      darkTheme: buildDarkTheme(),
      themeMode: themeMode,
      routerConfig: router,
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'shared/app_shell.dart';

void main() {
  runApp(const ProviderScope(child: DevxApp()));
}

/// Root widget for the devx mobile companion.
///
/// Theme + router foundations land in a10002; until then this is a plain
/// MaterialApp hosting the 4-tab [AppShell].
class DevxApp extends StatelessWidget {
  const DevxApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'devx',
      theme: ThemeData(useMaterial3: true),
      home: const AppShell(),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'router.dart';

/// App-wide theme mode. Defaults to following the system light/dark setting;
/// a settings surface can override it later.
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

/// App router, one per ProviderScope — widget tests get isolated navigation
/// state instead of sharing a global GoRouter's stack.
final routerProvider = Provider<GoRouter>((ref) => buildAppRouter());

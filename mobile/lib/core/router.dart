import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../features/activity/activity_screen.dart';
import '../features/add_item/add_item_screen.dart';
import '../features/backlogs/backlogs_screen.dart';
import '../features/inbox/inbox_screen.dart';
import '../shared/app_shell.dart';

/// Route names — navigate with `context.goNamed(RouteNames.inbox)` so typos
/// fail at the name table, not silently.
abstract final class RouteNames {
  static const inbox = 'inbox';
  static const backlogs = 'backlogs';
  static const add = 'add';
  static const activity = 'activity';
}

/// Builds the app router: a stateful shell route hosts [AppShell]; each tab
/// is a branch so per-tab navigation stacks and scroll state survive tab
/// switches. A factory (not a global) so every ProviderScope — including each
/// widget test — gets a fresh navigation state; see routerProvider.
GoRouter buildAppRouter() => GoRouter(
  initialLocation: '/inbox',
  errorBuilder: (context, state) => _RouteErrorScreen(error: state.error),
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) =>
          AppShell(navigationShell: navigationShell),
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/inbox',
              name: RouteNames.inbox,
              builder: (context, state) => const InboxScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/backlogs',
              name: RouteNames.backlogs,
              builder: (context, state) => const BacklogsScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/add',
              name: RouteNames.add,
              builder: (context, state) => const AddItemScreen(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/activity',
              name: RouteNames.activity,
              builder: (context, state) => const ActivityScreen(),
            ),
          ],
        ),
      ],
    ),
  ],
);

class _RouteErrorScreen extends StatelessWidget {
  const _RouteErrorScreen({this.error});

  final Exception? error;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Page not found')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            error?.toString() ?? 'Unknown route',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ),
    );
  }
}

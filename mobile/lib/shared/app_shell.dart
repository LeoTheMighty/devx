import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// 4-tab navigation shell: Inbox / Backlogs / Add / Activity.
///
/// Hosted by the router's StatefulShellRoute — [navigationShell] renders the
/// active branch and preserves each branch's navigation + scroll state.
class AppShell extends StatelessWidget {
  const AppShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) => navigationShell.goBranch(
          index,
          // Re-tapping the active tab pops that branch to its initial route.
          initialLocation: index == navigationShell.currentIndex,
        ),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.inbox_outlined),
            label: 'Inbox',
          ),
          NavigationDestination(
            icon: Icon(Icons.list_alt_outlined),
            label: 'Backlogs',
          ),
          NavigationDestination(
            icon: Icon(Icons.add_circle_outline),
            label: 'Add',
          ),
          NavigationDestination(
            icon: Icon(Icons.timeline_outlined),
            label: 'Activity',
          ),
        ],
      ),
    );
  }
}

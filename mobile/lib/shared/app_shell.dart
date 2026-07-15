import 'package:flutter/material.dart';

import '../features/activity/activity_screen.dart';
import '../features/add_item/add_item_screen.dart';
import '../features/backlogs/backlogs_screen.dart';
import '../features/inbox/inbox_screen.dart';

/// 4-tab navigation shell: Inbox / Backlogs / Add / Activity.
///
/// Tab state is local for now; go_router takes over navigation in a10002.
class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _selectedIndex = 0;

  static const _screens = <Widget>[
    InboxScreen(),
    BacklogsScreen(),
    AddItemScreen(),
    ActivityScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _selectedIndex, children: _screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) =>
            setState(() => _selectedIndex = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.inbox_outlined), label: 'Inbox'),
          NavigationDestination(
            icon: Icon(Icons.list_alt_outlined),
            label: 'Backlogs',
          ),
          NavigationDestination(icon: Icon(Icons.add_circle_outline), label: 'Add'),
          NavigationDestination(
            icon: Icon(Icons.timeline_outlined),
            label: 'Activity',
          ),
        ],
      ),
    );
  }
}

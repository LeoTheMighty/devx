import 'package:flutter/material.dart';

/// Shared placeholder body for the four tab screens: a title, the
/// 'Coming in E-n' line, and enough placeholder rows to be scrollable
/// (empty states are a surface; scroll state is exercised by tests).
class ComingSoonList extends StatelessWidget {
  const ComingSoonList({
    required this.title,
    required this.comingIn,
    super.key,
  });

  /// Tab title, e.g. 'Inbox'.
  final String title;

  /// Epic reference, e.g. 'E2 — github-connection-read'.
  final String comingIn;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return ListView.builder(
      itemCount: 32,
      itemBuilder: (context, index) {
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 4),
            child: Text(
              title,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          );
        }
        if (index == 1) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
              'Coming in $comingIn',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: colorScheme.onSurfaceVariant),
            ),
          );
        }
        return ListTile(
          leading: Icon(Icons.circle_outlined, color: colorScheme.outline),
          title: Text('$title row ${index - 2}'),
          subtitle: Text('Placeholder — $comingIn'),
        );
      },
    );
  }
}

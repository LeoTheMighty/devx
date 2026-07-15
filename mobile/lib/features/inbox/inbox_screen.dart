import 'package:flutter/material.dart';

/// Placeholder Inbox screen — real content lands in a later epic.
class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Inbox', style: Theme.of(context).textTheme.headlineMedium),
          const Text('(placeholder — epic-flutter-scaffold-ios-device)'),
        ],
      ),
    );
  }
}

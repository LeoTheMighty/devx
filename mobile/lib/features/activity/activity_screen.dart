import 'package:flutter/material.dart';

/// Placeholder Activity screen — real content lands in a later epic.
class ActivityScreen extends StatelessWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Activity', style: Theme.of(context).textTheme.headlineMedium),
          const Text('(placeholder — epic-flutter-scaffold-ios-device)'),
        ],
      ),
    );
  }
}

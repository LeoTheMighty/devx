import 'package:flutter/material.dart';

/// Placeholder Backlogs screen — real content lands in a later epic.
class BacklogsScreen extends StatelessWidget {
  const BacklogsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Backlogs', style: Theme.of(context).textTheme.headlineMedium),
          const Text('(placeholder — epic-flutter-scaffold-ios-device)'),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';

/// Placeholder Add screen — real content lands in a later epic.
class AddItemScreen extends StatelessWidget {
  const AddItemScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('Add', style: Theme.of(context).textTheme.headlineMedium),
          const Text('(placeholder — epic-flutter-scaffold-ios-device)'),
        ],
      ),
    );
  }
}

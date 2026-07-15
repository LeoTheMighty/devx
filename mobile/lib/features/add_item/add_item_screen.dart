import 'package:flutter/material.dart';

import '../../shared/coming_soon_list.dart';

/// Placeholder Add screen — real content lands in E3 — bidirectional-writes-offline.
class AddItemScreen extends StatelessWidget {
  const AddItemScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingSoonList(
      title: 'Add',
      comingIn: 'E3 — bidirectional-writes-offline',
    );
  }
}

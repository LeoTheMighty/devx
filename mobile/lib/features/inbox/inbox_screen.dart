import 'package:flutter/material.dart';

import '../../shared/coming_soon_list.dart';

/// Placeholder Inbox screen — real content lands in E2 — github-connection-read.
class InboxScreen extends StatelessWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingSoonList(
      title: 'Inbox',
      comingIn: 'E2 — github-connection-read',
    );
  }
}

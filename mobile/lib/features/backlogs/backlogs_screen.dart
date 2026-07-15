import 'package:flutter/material.dart';

import '../../shared/coming_soon_list.dart';

/// Placeholder Backlogs screen — real content lands in E2 — github-connection-read.
class BacklogsScreen extends StatelessWidget {
  const BacklogsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingSoonList(
      title: 'Backlogs',
      comingIn: 'E2 — github-connection-read',
    );
  }
}

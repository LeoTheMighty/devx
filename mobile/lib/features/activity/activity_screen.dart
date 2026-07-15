import 'package:flutter/material.dart';

import '../../shared/coming_soon_list.dart';

/// Placeholder Activity screen — real content lands in E4 — realtime-updates-push.
class ActivityScreen extends StatelessWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ComingSoonList(
      title: 'Activity',
      comingIn: 'E4 — realtime-updates-push',
    );
  }
}

import 'package:devx/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('app boots and renders 4 tabs', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: DevxApp()));

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.text('Inbox'), findsWidgets);
    expect(find.text('Backlogs'), findsOneWidget);
    expect(find.text('Add'), findsOneWidget);
    expect(find.text('Activity'), findsOneWidget);
  });

  testWidgets('tapping a tab switches the visible screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: DevxApp()));

    // Before the switch only the nav label 'Backlogs' is onstage; the
    // Backlogs screen title is offstage inside the IndexedStack.
    expect(find.text('Backlogs'), findsOneWidget);

    await tester.tap(find.widgetWithText(NavigationDestination, 'Backlogs'));
    await tester.pumpAndSettle();

    // After the switch both the nav label and the screen title are onstage.
    expect(find.text('Backlogs'), findsNWidgets(2));
  });
}

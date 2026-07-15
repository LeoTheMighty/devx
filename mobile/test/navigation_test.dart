import 'package:devx/core/providers.dart';
import 'package:devx/features/activity/activity_screen.dart';
import 'package:devx/features/add_item/add_item_screen.dart';
import 'package:devx/features/backlogs/backlogs_screen.dart';
import 'package:devx/features/inbox/inbox_screen.dart';
import 'package:devx/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> pumpApp(WidgetTester tester, {ProviderContainer? container}) async {
  final child = container == null
      ? const ProviderScope(child: DevxApp())
      : UncontrolledProviderScope(container: container, child: const DevxApp());
  await tester.pumpWidget(child);
  await tester.pumpAndSettle();
}

Future<void> tapTab(WidgetTester tester, String label) async {
  await tester.tap(find.widgetWithText(NavigationDestination, label));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('tab taps navigate to each named route screen', (tester) async {
    await pumpApp(tester);

    expect(find.byType(InboxScreen), findsOneWidget);
    expect(find.text('Coming in E2 — github-connection-read'), findsOneWidget);

    await tapTab(tester, 'Backlogs');
    expect(find.byType(BacklogsScreen), findsOneWidget);

    await tapTab(tester, 'Add');
    expect(find.byType(AddItemScreen), findsOneWidget);
    expect(
      find.text('Coming in E3 — bidirectional-writes-offline'),
      findsOneWidget,
    );

    await tapTab(tester, 'Activity');
    expect(find.byType(ActivityScreen), findsOneWidget);
    expect(find.text('Coming in E4 — realtime-updates-push'), findsOneWidget);

    await tapTab(tester, 'Inbox');
    expect(find.byType(InboxScreen), findsOneWidget);
  });

  testWidgets('navigating away and back preserves scroll position',
      (tester) async {
    await pumpApp(tester);

    // The Inbox headline is at the top of the list; scroll it out of view.
    expect(find.text('Inbox'), findsNWidgets(2)); // nav label + headline
    await tester.fling(find.byType(ListView), const Offset(0, -600), 2000);
    await tester.pumpAndSettle();
    expect(find.text('Inbox'), findsOneWidget); // headline scrolled offstage

    final offsetBefore = tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .pixels;
    expect(offsetBefore, greaterThan(0));

    await tapTab(tester, 'Backlogs');
    expect(find.byType(BacklogsScreen), findsOneWidget);

    await tapTab(tester, 'Inbox');
    expect(find.text('Inbox'), findsOneWidget); // still scrolled down
    final offsetAfter = tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .pixels;
    expect(offsetAfter, offsetBefore);
  });

  testWidgets('themeMode: system respects platform brightness', (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    await pumpApp(tester);

    final context = tester.element(find.byType(NavigationBar));
    expect(Theme.of(context).brightness, Brightness.dark);

    tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
    await tester.pumpAndSettle();
    expect(Theme.of(context).brightness, Brightness.light);
  });

  testWidgets('themeModeProvider toggle overrides system brightness',
      (tester) async {
    tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container: container);

    final context = tester.element(find.byType(NavigationBar));
    expect(Theme.of(context).brightness, Brightness.dark); // system → dark

    container.read(themeModeProvider.notifier).state = ThemeMode.light;
    await tester.pumpAndSettle();
    expect(Theme.of(context).brightness, Brightness.light);

    container.read(themeModeProvider.notifier).state = ThemeMode.dark;
    await tester.pumpAndSettle();
    expect(Theme.of(context).brightness, Brightness.dark);
  });

  testWidgets('unknown route renders the error page', (tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await pumpApp(tester, container: container);

    container.read(routerProvider).go('/nonexistent');
    await tester.pumpAndSettle();
    expect(find.text('Page not found'), findsOneWidget);
  });
}

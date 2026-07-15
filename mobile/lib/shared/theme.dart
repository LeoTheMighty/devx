import 'package:flutter/material.dart';

/// Material 3 themes for the devx companion. The seed color is the single
/// color definition point — everything else derives from the ColorScheme.
const _seedColor = Color(0xFF3F51B5);

ThemeData buildLightTheme() {
  return ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(seedColor: _seedColor),
  );
}

ThemeData buildDarkTheme() {
  return ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: _seedColor,
      brightness: Brightness.dark,
    ),
  );
}

## (from /devx-init) Target platforms — which to enable?

A `pubspec.yaml` was detected. Each platform you ship to has its own toolchain,
test surface, and CI cost.

**Options (multi-select):** iOS / Android / web / macOS / Windows / Linux.
**Recommendation:** start with iOS + Android only; add platforms once the
mobile loop ships and you've felt the multi-platform CI cost.

- [ ] Pick the target platforms for this project.

## (from /devx-init) State management — Riverpod, Provider, Bloc, or setState only?

Decides what the BMAD architecture doc treats as canonical for new screens.

**Options:** Riverpod (default — devx mobile uses it) / Provider / Bloc / setState only (smallest projects).
**Recommendation:** Riverpod unless you already prefer otherwise.

- [ ] Pick a state-management approach.

## (from /devx-init) Min Flutter SDK — latest stable, or oldest LTS-ish?

Newer SDK gets you newer Material 3 + Impeller; older keeps the on-device
constraint loose for testers running outdated phones.

**Options:** latest stable / one-minor-back / two-minors-back.
**Recommendation:** latest stable for solo dogfood; pin one-minor-back if
you have testers on older devices.

- [ ] Pick a Flutter SDK floor.

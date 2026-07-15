---
hash: c98aee
type: test
created: 2026-07-15T11:26:00-06:00
title: Wire flutter analyze + test into devx-ci for mobile/
from: dev/dev-a10001-2026-04-23T13:01-flutter-project-scaffold.md
status: ready
---

## Goal
Remote CI gates mobile/ the same way local Phase 5 does. As of a10001 (PR #76)
`mobile/` exists but `.github/workflows/devx-ci.yml` runs only the node CLI
matrix — its own header comment lists "flutter analyze + flutter test for
mobile/ (Phase 8 onward)" as future work. Until this ships, mobile regressions
are invisible to remote CI and the YOLO merge gate.

## Acceptance criteria
- [ ] devx-ci.yml gains a flutter job (setup Flutter 3.38.x stable, `flutter analyze`, `flutter test`) scoped to run when `mobile/**` paths change
- [ ] Job is green on a PR touching mobile/ and skipped (or trivially green) on CLI-only PRs
- [ ] Workflow header comment updated to reflect reality

## Technical notes
- Use `subosito/flutter-action` or equivalent pinned setup; match the version documented in `mobile/README.md` (3.38.9).
- Path filter via `dorny/paths-filter` or `on.pull_request.paths` — but beware: a paths-filtered required check never reports on unrelated PRs; prefer an in-job filter so the check always reports.

## Status log
- 2026-07-15T11:26 — filed by /devx during a10001 cleanup (gap observed at Phase 7: probe returned devx-ci success without any flutter execution)

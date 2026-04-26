---
hash: b20005
type: dev
created: 2026-04-23T13:14:00-07:00
title: Backlogs tab + spec detail view
from: _bmad-output/planning-artifacts/epic-github-connection-read.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-b20005
blocked_by: [b20003]
---

## Goal
Backlogs tab with an 8-way TabBar. Tapping an item opens the spec detail screen that renders the `dev/*.md` (or equivalent) file's content + its status log.

## Acceptance criteria
- [ ] TabBar with 8 tabs: DEV / PLAN / TEST / DEBUG / FOCUS / INTERVIEW / MANUAL / LESSONS
- [ ] Each tab lists items with title + status chip + source spec-file handle
- [ ] Tap navigates to spec detail; `ContentsClient.read(path)` fetches the underlying spec file
- [ ] Spec detail renders markdown via `flutter_markdown`; status log shows as a timeline
- [ ] Back nav preserves scroll position in the tab
- [ ] Widget tests cover each tab + detail navigation + back-scroll preservation

## Technical notes
- TabBar state persists per-session (remembers last tab)
- Detail fetch is lazy — only on tap, not pre-fetched
- Status chip colors map to project theme: ready (blue), in-progress (yellow), blocked (red), done (green), awaiting-approval (purple)

## Status log
- 2026-04-23T13:14 — created by /dev-plan — Milestone M2 target

## Files expected
- `mobile/lib/features/backlogs/backlogs_screen.dart`
- `mobile/lib/features/backlogs/backlog_tab.dart`
- `mobile/lib/features/backlogs/backlog_row.dart`
- `mobile/lib/features/spec_detail/spec_detail_screen.dart`
- `mobile/lib/shared/widgets/status_chip.dart`
- `mobile/test/features/backlogs_test.dart`
- `mobile/test/features/spec_detail_test.dart`

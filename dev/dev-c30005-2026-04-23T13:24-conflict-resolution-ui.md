---
hash: c30005
type: dev
created: 2026-04-23T13:24:00-07:00
title: Conflict resolution UI (3-way view for exhausted retries)
from: _bmad-output/planning-artifacts/epic-bidirectional-writes-offline.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-c30005
blocked_by: [c30003, c30004]
---

## Goal
When a queued write exhausts its retries (`drift` row status: `manual`), surface a resolution screen: remote version (read-only) alongside user's pending change (editable), with keep/discard/merge options.

## Acceptance criteria
- [ ] `ConflictResolutionScreen` takes a `PendingWrite` with status `manual`
- [ ] Shows remote file content + user's pending change side-by-side (or stacked on narrow screens)
- [ ] Three buttons: "Keep mine (overwrite)" — forces a new commit, "Discard mine" — deletes the queue row, "Merge manually" — opens an editor with both versions loaded
- [ ] "Keep mine" forces a fresh ref fetch and retries with user's intent
- [ ] Widget test covers all three resolutions

## Technical notes
- "Keep mine (overwrite)" can only write what the user's queued change intended — not arbitrary content. The button label may be misleading; prefer "Force my change"
- Auto-opens from Inbox if any `manual`-status writes exist, with a banner "N unresolved conflicts"
- Milestone M3 target (depends on this working for the demo)

## Status log
- 2026-04-23T13:24 — created by /dev-plan — Milestone M3 target

## Files expected
- `mobile/lib/features/conflicts/conflict_resolution_screen.dart`
- `mobile/lib/features/conflicts/conflict_controller.dart`
- `mobile/lib/features/conflicts/merge_editor.dart`
- `mobile/test/features/conflict_resolution_test.dart`

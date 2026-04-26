---
hash: c30002
type: dev
created: 2026-04-23T13:21:00-07:00
title: Git Data API client (atomic multi-file commit)
from: _bmad-output/planning-artifacts/epic-bidirectional-writes-offline.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-c30002
blocked_by: [b20002]
---

## Goal
Implement the 6-step Git Data API sequence (ref → commit → tree → blobs → new tree → new commit → update ref) as `GitDataClient.atomicCommit({files, branch, message})`. Retry on 422 (non-fast-forward) up to 3 times with fresh parent refs.

## Acceptance criteria
- [ ] `GitDataClient.atomicCommit(branch, message, files)` takes a list of `{path, content}` entries
- [ ] Implements the 6 steps; combines in ~150 lines of Dart
- [ ] Reuses blobs when possible (hash-based deduping)
- [ ] On 422 from `updateRef`, refetches ref and retries up to 3 times
- [ ] Returns commit sha on success
- [ ] Unit tests mock `dio` and cover: success, 422-retry-success, 422-exhaustion, 5xx-retry
- [ ] Commit message auto-prefixed with `devx-mobile:`

## Technical notes
- Blob uploads can parallel — use `Future.wait`
- Tree construction must preserve existing tree entries that aren't being modified (use base_tree)
- Never force-push; the retry is a rebase-append, not a clobber

## Status log
- 2026-04-23T13:21 — created by /dev-plan

## Files expected
- `mobile/lib/core/github/git_data_client.dart`
- `mobile/lib/core/github/git_data_models.dart`
- `mobile/test/core/github/git_data_client_test.dart`
- `mobile/test/core/github/git_data_conflict_test.dart`

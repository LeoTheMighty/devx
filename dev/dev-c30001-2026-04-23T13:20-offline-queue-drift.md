---
hash: c30001
type: dev
created: 2026-04-23T13:20:00-07:00
title: Offline queue foundation (drift + connectivity listener)
from: _bmad-output/planning-artifacts/epic-bidirectional-writes-offline.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-c30001
blocked_by: [b20005]
---

## Goal
Stand up a `drift` SQLite database with a `PendingWrite` table. `QueueDrainer` listens to connectivity and drains FIFO on network-up. Per-row attempt tracking with a 3-attempt ceiling.

## Acceptance criteria
- [ ] `drift` dependency added; generated code committed
- [ ] Schema: `PendingWrite(id, createdAt, kind, payload, attempts, lastError, status)`
- [ ] `status` values: `queued`, `in_flight`, `manual` (conflict exhausted)
- [ ] `QueueDrainer` listens to `connectivity_plus`; on ConnectivityResult.any non-none, drains
- [ ] Drain dispatches to writers based on `kind` (`add_item` / `answer_interview`)
- [ ] 3-attempt ceiling per row; 4th flips `status` to `manual`
- [ ] Unit tests cover CRUD, drain loop, retry, exhaustion

## Technical notes
- drift DB stored under app documents directory (`path_provider`)
- Drain is single-threaded via `Lock` — no concurrent drains
- `payload` is JSON of the write intent (slug, type, text, etc.)
- Writers are injected (not hardcoded) so tests can mock

## Status log
- 2026-04-23T13:20 — created by /dev-plan

## Files expected
- `mobile/pubspec.yaml` (+drift, +drift_flutter, +path_provider, +connectivity_plus, +synchronized)
- `mobile/lib/core/queue/database.dart`
- `mobile/lib/core/queue/database.g.dart` (generated)
- `mobile/lib/core/queue/pending_write.dart`
- `mobile/lib/core/queue/queue_drainer.dart`
- `mobile/lib/core/queue/writer_dispatch.dart`
- `mobile/test/core/queue/queue_drainer_test.dart`

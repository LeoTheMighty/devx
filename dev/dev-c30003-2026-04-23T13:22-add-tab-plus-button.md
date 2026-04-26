---
hash: c30003
type: dev
created: 2026-04-23T13:22:00-07:00
title: Add tab — (+) button flow (atomic spec + DEV.md append)
from: _bmad-output/planning-artifacts/epic-bidirectional-writes-offline.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-c30003
blocked_by: [c30001, c30002]
---

## Goal
Wire the Add tab: single TextField + type dropdown (default `dev`) + submit. On submit, construct a spec file from template + DEV.md append, queue the atomic commit.

## Acceptance criteria
- [ ] `AddItemScreen` renders: TextField + type picker + submit button
- [ ] Submit generates hash (6 random hex), timestamp (ISO with minute precision), slug (see slug rules below), and spec file content
- [ ] Writes go through `QueueDrainer` → `GitDataClient.atomicCommit({spec-file, DEV.md})` on `develop`
- [ ] UI shows: "Added." (online success), "Queued (will sync when online)." (offline), "Conflict — tap to resolve." (3-attempt exhaustion)
- [ ] Widget test covers all three paths via injected mock drainer

## Slug rules
- Lowercase, kebab, ASCII-only, cap at 50 chars, trim trailing hyphens
- Collisions resolved by suffix `-2`, `-3`, etc. (looked up from existing dev/*.md files at compose time)

## Technical notes
- Template lives in `mobile/lib/features/add_item/spec_template.dart`
- Hash via `Random.secure()` → 6 hex chars
- On enqueue, `drift` row `kind = "add_item"` with payload = `{type, title, slug, hash, timestamp}`

## Status log
- 2026-04-23T13:22 — created by /dev-plan

## Files expected
- `mobile/lib/features/add_item/add_item_screen.dart`
- `mobile/lib/features/add_item/add_item_controller.dart`
- `mobile/lib/features/add_item/slug_generator.dart`
- `mobile/lib/features/add_item/spec_template.dart`
- `mobile/test/features/add_item_test.dart`

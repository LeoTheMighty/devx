<!-- refined: party-mode 2026-04-23 -->

# Epic — Bidirectional writes + offline queue

**Plan:** `plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md`
**Slug:** `epic-bidirectional-writes-offline`
**Order:** 3 of 4
**User sees:** "I can add /dev items and answer questions from my phone — even without signal."

## Overview
Implement the writer side of the app. Two write paths: (a) the (+) button on Add tab that atomically commits a new `dev/*.md` spec file + a DEV.md append via the Git Data API, and (b) inline INTERVIEW answering via the Contents API. Offline queue via `drift` makes every write survive no-signal conditions. Conflict handling via optimistic concurrency with exponential-backoff retry.

## Goal
Phone becomes a full producer of backlog items, durable against connectivity loss, correct under concurrent edits from the laptop.

## End-user flow
1. Leonid taps Add → text field + type picker (default `dev`).
2. He types "Add audiobook import support" and submits.
3. App writes a `PendingWrite` to `drift`, attempts the commit immediately.
4. If online: Git Data API sequence constructs an atomic commit on `develop` writing `dev/dev-<hash>-<ts>-add-audiobook-import-support.md` + appending to `DEV.md`. UI shows "Added. Triage will pick this up in ~30s."
5. If offline: UI shows "Queued (will sync when online)." Queue drains on next connectivity event.
6. Leonid taps an open INTERVIEW question → inline text field → submits. App does a single-file Contents API update, optimistic-sha; on 409 (sha stale) retries up to 3x; if still stale, surfaces a conflict UI.

## Frontend changes
- `lib/core/github/git_data_client.dart` — wrapper over `/git/blobs`, `/git/trees`, `/git/commits`, `/git/refs`. Handles the multi-step atomic commit flow.
- `lib/core/github/contents_writer.dart` — single-file edit wrapper with sha-based concurrency.
- `lib/core/queue/` — `drift` schema for `PendingWrite`, queue drainer service.
- `lib/features/add_item/` — Add tab with single TextField + type dropdown + submit.
- Hooks into existing `InterviewScreen` to enable inline answering UI.
- Background isolate for queue drain on connectivity-up.

## Backend changes
None this epic. (The Cloudflare Worker ships in E4; for now, writes are direct to GitHub.)

## Infrastructure changes
- Branch protection on `main` — enforce via `gh api` during `/dev-init` later; for this epic, document that the app only targets `develop` and will 403 if the branch doesn't exist.
- Ensure `develop` branch exists in the repo before testing writes.

## Design principles (from research)
- **Atomic two-file write**: MUST use Git Data API. Contents API's one-file-per-call shape would leave a window where `DEV.md` points at a nonexistent spec.
- **Optimistic concurrency first, conflict UI last**: the vast majority of writes should never see a 409. Design for the common case.
- **Queue is the source of truth while offline.** UI reflects queue state, not "what we think is on GitHub."
- **Retries are bounded.** Never spam GitHub. 3 retries with exponential backoff, then surface to user.
- **Phone commits are tagged in the commit message**: `devx-mobile: add dev-<hash> (<slug>)\n\nSource: mobile v0.1`. This lets `git log --grep 'devx-mobile:'` find every mobile-originated commit.

## File structure
```
mobile/
├── pubspec.yaml                                       ← +drift, +drift_flutter, +path_provider, +connectivity_plus
├── lib/
│   ├── core/
│   │   ├── github/
│   │   │   ├── git_data_client.dart
│   │   │   └── contents_writer.dart
│   │   └── queue/
│   │       ├── database.dart                          ← drift schema
│   │       ├── pending_write.dart                     ← row type
│   │       └── queue_drainer.dart                     ← background drain on connectivity
│   ├── features/
│   │   ├── add_item/
│   │   │   ├── add_item_screen.dart
│   │   │   ├── add_item_controller.dart
│   │   │   └── slug_generator.dart                    ← text → kebab-slug
│   │   └── interview/
│   │       └── answer_field.dart                      ← inline answer widget
└── test/
    ├── core/github/
    │   ├── git_data_client_test.dart                  ← mocks the 6-step sequence
    │   └── contents_writer_conflict_test.dart         ← 409 retry paths
    └── features/add_item/
        └── add_item_flow_test.dart                    ← online + offline + conflict
```

## Story list with ACs

### 3.1 Offline queue foundation
- [ ] `drift` dependency added; schema defines `PendingWrite(id, createdAt, kind, payload, attempts, lastError)`
- [ ] `QueueDrainer` service listens to `connectivity_plus`; on online event, drains FIFO
- [ ] Drain attempts call into the appropriate writer (GitData or Contents) based on `kind`
- [ ] Max 3 attempts per row; 4th attempt flips row to `status: manual` and surfaces conflict UI
- [ ] Unit tests cover queue CRUD + drain loop

### 3.2 Git Data API atomic commit client
- [ ] `GitDataClient.atomicCommit({files, branch, message})` implements the 6-step sequence (get ref → get commit → create blobs → create tree → create commit → update ref)
- [ ] On 422 (non-fast-forward), re-runs the sequence from step 1 (up to 3 attempts)
- [ ] Unit tests mock `dio` and cover: success path, 422 retry, 422 exhaustion
- [ ] Hardcoded commit message prefix: `devx-mobile:`

### 3.3 Add tab + (+) button flow
- [ ] `AddItemScreen` shows TextField + type dropdown + submit
- [ ] Submit generates `hash` (6 hex) + timestamp + slug, constructs spec-file content from template, calls queue → drainer
- [ ] UI shows "Added." on success, "Queued." on offline, "Conflict — tap to resolve." on exhaustion
- [ ] Widget test covers all three outcomes via mocked drainer

### 3.4 Inline INTERVIEW answering
- [ ] Tapping an INTERVIEW item reveals inline TextField
- [ ] Submit calls `ContentsWriter.updateFile({path: INTERVIEW.md, sha, newContent})`
- [ ] On 409 (stale sha): refetch, rebuild the answered markdown, retry up to 3x
- [ ] On persistent 409: surface conflict resolution UI (show remote version + user's pending answer)
- [ ] Widget test covers success, retry-success, retry-exhaustion

### 3.5 Conflict resolution UI
- [ ] Dedicated screen: "This file changed remotely while you were editing"
- [ ] Shows remote content (read-only) + user's pending change (editable)
- [ ] "Keep mine (overwrite)" / "Discard mine" / "Merge manually" buttons
- [ ] Widget test covers all three resolution paths

## Dependencies
- **Depends on:** Epic 2 (auth + GitHub client, parser types).
- **Blocks:** Epic 4 (real-time updates need write events as their source).

## Open questions
1. **Which conventional-commit prefix for `devx-mobile:` commits?** Current choice: literal `devx-mobile:` (not `feat(mobile):`). This is a deliberate marker so LearnAgent can identify phone origin. Lock in.
2. **Max queue size?** Hard cap at 500 pending writes, then block new Adds with "Queue full — connect to sync." Unlikely to hit in practice.
3. **Slug generation rules.** Lowercase, kebab, ASCII-only, cap at 50 chars, trim trailing hyphens. Collisions resolved by suffix. Lock in.

## Milestone
**M3 — "I can act from my phone."** Success = Leonid adds 3 `/dev` items over the course of a day (including at least one in airplane mode), all appear on laptop as atomic `develop` commits without conflicts.

## Party-mode critique (team lenses)

- **PM**: The (+) button is the single feature that makes the phone valuable. Every other feature is support. Get this right.
- **UX**: "Queued" state badges matter. Users need to trust that an offline add isn't lost. Consider a persistent "N items pending" status at the bottom when queue is non-empty.
- **Frontend**: Git Data API sequence is 6 round-trips — slow on bad networks. Consider batching via GraphQL in v0.2 (one mutation instead of six REST calls). For v0.1, REST is fine.
- **Backend**: N/A.
- **Infrastructure**: Branch protection on `main` MUST be in place before this ships to prod — otherwise a bug in the slug generator could technically write to main. File as a `MANUAL.md` item: "Enable branch protection on main with 'Restrict pushes'".
- **QA**: Offline → online transitions are the highest-risk paths. CI must run integration tests that toggle connectivity (via `flutter_test` harness). Add flaky-detection from day one.
- **Locked decisions fed forward**: `devx-mobile:` commit prefix; queue kind enum (`add_item`, `answer_interview`); conflict-resolution pattern; 3-retry / exponential-backoff contract.

## Focus-group reactions
Skipped — YOLO mode.

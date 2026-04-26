---
hash: c30004
type: dev
created: 2026-04-23T13:23:00-07:00
title: Inline INTERVIEW answering (Contents API single-file write)
from: _bmad-output/planning-artifacts/epic-bidirectional-writes-offline.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-c30004
blocked_by: [c30001, b20004]
---

## Goal
Enable the "answer" affordance on INTERVIEW rows in the Inbox tab. Inline TextField; on submit, write the answered markdown back via Contents API with optimistic-sha concurrency.

## Acceptance criteria
- [ ] Tapping an INTERVIEW row opens inline TextField (not a new screen)
- [ ] Submit calls `ContentsWriter.updateFile({path: INTERVIEW.md, sha, newContent})`
- [ ] On 409 (stale sha): refetches `INTERVIEW.md`, rebuilds the answered markdown preserving other answers, retries up to 3 times
- [ ] On persistent 409 or other failure: surface conflict UI (see story c30005)
- [ ] Widget test covers success, retry-then-success, retry-exhaustion

## Technical notes
- "Rebuild answered markdown" means: find the specific `- [ ] Q#N` line, replace with `- [x]` + append a `→ Answer: <user text>` line; preserve all other lines
- Optimistic concurrency: always send the `sha` you read; GitHub returns 409 if it's stale
- This write is queued like any other — offline survival applies

## Status log
- 2026-04-23T13:23 — created by /dev-plan

## Files expected
- `mobile/lib/core/github/contents_writer.dart`
- `mobile/lib/features/inbox/inline_answer.dart`
- `mobile/lib/features/inbox/interview_row.dart` (refined from b20004)
- `mobile/lib/core/markdown/interview_rewriter.dart`
- `mobile/test/core/github/contents_writer_test.dart`
- `mobile/test/features/inline_answer_test.dart`

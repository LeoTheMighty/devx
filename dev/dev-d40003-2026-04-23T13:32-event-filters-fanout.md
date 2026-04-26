---
hash: d40003
type: dev
created: 2026-04-23T13:32:00-07:00
title: Event filters + fanout to device tokens
from: _bmad-output/planning-artifacts/epic-realtime-updates-push.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-d40003
blocked_by: [d40002]
---

## Goal
Classify incoming webhook events and fan out push notifications. Only meaningful events generate pushes; everything else is 200-acknowledged and dropped.

## Acceptance criteria
- [ ] `filters.ts` classifies events → `{kind, summary, deep_link}`; returns `null` for non-notable events
- [ ] Supported events:
  - `push` filtered by changed paths: INTERVIEW.md, MANUAL.md, DEV.md
  - `pull_request` with action in {opened, review_requested}
  - `check_suite` with `conclusion: failure`
  - `workflow_run` with `conclusion` in {failure, cancelled, timed_out}
- [ ] Fanout reads KV device tokens for the repo; calls `fcm.sendToToken` per token in parallel
- [ ] Failures per-token logged to dead-letter; successes logged to a rolling counter KV key
- [ ] Unit tests cover classifier + fanout happy path + partial failure

## Technical notes
- KV scan for tokens: `list({prefix: 'repo:<owner/name>:'})`
- Each push event's changed paths come from `payload.commits[*].{added,modified,removed}`
- Payload shape uniform across event types: `{kind, summary, deep_link, repo, emitted_at}`

## Status log
- 2026-04-23T13:32 — created by /dev-plan

## Files expected
- `worker/src/filters.ts`
- `worker/src/fanout.ts`
- `worker/src/webhook_github.ts` (expanded)
- `worker/test/filters.test.ts`
- `worker/test/fanout.test.ts`

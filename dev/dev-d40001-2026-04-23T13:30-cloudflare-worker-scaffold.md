---
hash: d40001
type: dev
created: 2026-04-23T13:30:00-07:00
title: Cloudflare Worker scaffold + GitHub webhook HMAC verification
from: _bmad-output/planning-artifacts/epic-realtime-updates-push.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-d40001
blocked_by: [c30005]
---

## Goal
Initialize `worker/` with `wrangler`. Implement POST `/webhook/github` that verifies `X-Hub-Signature-256` against a shared HMAC secret. Bind KV namespace `DEVX_PUSH`.

## Acceptance criteria
- [ ] `worker/` via `wrangler init` with TypeScript + modules template
- [ ] `wrangler.toml` configured: account ID, KV binding `DEVX_PUSH`
- [ ] POST `/webhook/github` parses payload, verifies `X-Hub-Signature-256` using `crypto.subtle.verify`
- [ ] 401 on mismatch; 200 on success with `{received: true}` (filter logic comes in story d40003)
- [ ] `wrangler deploy` uploads successfully; Worker URL recorded
- [ ] Unit tests cover HMAC verify (success, mismatch, missing header)

## Technical notes
- HMAC secret stored as Worker secret `GH_WEBHOOK_SECRET`
- Use `@cloudflare/workers-types` for typing
- KV namespace created via `wrangler kv:namespace create DEVX_PUSH`

## Status log
- 2026-04-23T13:30 — created by /dev-plan

## Files expected
- `worker/wrangler.toml`
- `worker/package.json`
- `worker/tsconfig.json`
- `worker/src/index.ts`
- `worker/src/webhook_github.ts`
- `worker/src/hmac.ts`
- `worker/test/hmac.test.ts`

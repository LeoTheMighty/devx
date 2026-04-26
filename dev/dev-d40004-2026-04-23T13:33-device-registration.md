---
hash: d40004
type: dev
created: 2026-04-23T13:33:00-07:00
title: Device registration + deregistration endpoints
from: _bmad-output/planning-artifacts/epic-realtime-updates-push.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-d40004
blocked_by: [d40001]
---

## Goal
Worker exposes `POST /devices/register` and `DELETE /devices/<device_id>` to manage push-token registrations, validated against the caller's GitHub PAT.

## Acceptance criteria
- [ ] `POST /devices/register` accepts `{token, repo, device_id}` in body, `Authorization: Bearer <PAT>` header
- [ ] Validates PAT via `GET https://api.github.com/user` + `GET /repos/<owner/name>` for access
- [ ] Returns 401 on invalid PAT, 403 on repo-access mismatch, 200 on success
- [ ] Stores `repo:<owner/name>:<device_id> → token` in KV
- [ ] `DELETE /devices/<device_id>` requires same PAT validation and removes the mapping
- [ ] Unit tests cover 200 + 401 + 403 paths

## Technical notes
- Device ID generated client-side (UUID v4), stored in app prefs
- No rate limiting needed for personal use; one user per devx instance
- KV keys don't include the PAT — only token + repo + device_id

## Status log
- 2026-04-23T13:33 — created by /dev-plan

## Files expected
- `worker/src/devices.ts`
- `worker/src/github_auth.ts`
- `worker/test/devices.test.ts`

---
hash: b20002
type: dev
created: 2026-04-23T13:11:00-07:00
title: GitHub client wrapper + Contents read client
from: _bmad-output/planning-artifacts/epic-github-connection-read.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-b20002
blocked_by: [b20001]
---

## Goal
Wrap `github` pub.dev + custom `ContentsClient` for sha-aware reads with `If-None-Match`. Handle rate limiting gracefully.

## Acceptance criteria
- [ ] `GithubClient` wraps high-level API calls (users, repos, PRs)
- [ ] `ContentsClient.readBacklog(path)` returns `(content, sha)`; supports conditional reads with `If-None-Match` / `If-Modified-Since`
- [ ] Rate-limit handling: 403 with `X-RateLimit-Remaining: 0` surfaces a banner "Rate limit hit — retry in N seconds"
- [ ] Retries on 5xx with backoff (up to 3 attempts)
- [ ] Unit tests mock `dio` + cover: 200, 304, 401, 403-rate-limit, 404, 500-retry

## Technical notes
- Returned `sha` stays in-memory for v0.1; drift-backed cache lands in E3 story b30001
- Use `dio` interceptors for auth header injection + rate-limit header parsing

## Status log
- 2026-04-23T13:11 — created by /dev-plan

## Files expected
- `mobile/lib/core/github/github_client.dart`
- `mobile/lib/core/github/contents_client.dart`
- `mobile/lib/core/github/models.dart`
- `mobile/lib/core/github/rate_limit_interceptor.dart`
- `mobile/test/core/github/contents_client_test.dart`

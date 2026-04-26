---
hash: d40007
type: dev
created: 2026-04-23T13:36:00-07:00
title: Laptop-side fast-path webhook receiver (optional)
from: _bmad-output/planning-artifacts/epic-realtime-updates-push.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-d40007
blocked_by: [d40003]
optional: true
---

## Goal
Optional fast-path: Cloudflare Tunnel exposes a local endpoint on Leonid's laptop. Worker mirrors filtered webhooks to it. A local receiver triggers immediate `git fetch` + Triage tick instead of waiting for the 30s polling interval.

## Acceptance criteria
- [ ] `docs/laptop-fastpath-setup.md` walks user through `cloudflared tunnel create devx-laptop`
- [ ] `scripts/laptop-webhook-receiver.py` (or sh) listens on a configured local port and writes `.devx-cache/last-signal.timestamp` on receive
- [ ] Worker accepts a `LAPTOP_RELAY_URL` env var per-user and POSTs mirror events to it (fire-and-forget)
- [ ] Triage watches `last-signal.timestamp` and skips its next poll cycle when fresh
- [ ] Documented explicitly as optional — v0.1 works without it via 30s polling

## Technical notes
- Cloudflare Tunnel free tier covers personal use
- Receiver validates the same HMAC secret as the main webhook (prevents replay)
- A missing `LAPTOP_RELAY_URL` is a no-op (not an error)

## Status log
- 2026-04-23T13:36 — created by /dev-plan — Milestone M4 target (optional — if time permits)

## Files expected
- `docs/laptop-fastpath-setup.md`
- `scripts/laptop-webhook-receiver.py`
- `worker/src/laptop_relay.ts`
- `worker/test/laptop_relay.test.ts`

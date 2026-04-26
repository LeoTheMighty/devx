---
hash: a03000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Cross-cutting — realtime stream + Live Activities (mobile v0.3.5)"
status: deferred
from: docs/MOBILE.md#realtime-updates--three-tier-architecture
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [frontend, infra]
blocked_by: [c4f1a2, 7a2d1f]
---

## Goal

Ship the three-tier realtime architecture: Cloudflare Durable Object + WebSocket stream consumed by iOS Live Activities + Android persistent notifications, with ManageAgent as the publisher of high-level transitions.

## Scope

- Cloudflare Worker + Durable Object — stream endpoint per project; ManageAgent publishes events.
- iOS Live Activity — tracks the most recent active worker; lock-screen presence.
- Android persistent notification — equivalent surface.
- Laptop event publisher hook — Manager calls Worker on every `agent_started` / `phase_changed` / `context_rot_detected` / `restarted` / `pr_opened` / `pr_merged`.

Cross-references [`MOBILE.md`](../docs/MOBILE.md) and [`COMPETITION.md`](../docs/COMPETITION.md) (Replit pattern).

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed.

## Acceptance criteria

- [ ] iOS Live Activity shows current worker phase + age, updates within 2s of Manager event.
- [ ] Android persistent notification renders the same data.
- [ ] Worker DO survives restart without losing active subscribers (within 60s reconnect).

## Status log

- 2026-04-26T19:30 — Cross-cutting placeholder created

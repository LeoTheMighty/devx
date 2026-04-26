---
hash: f02000
type: plan
created: 2026-04-26T19:30:00-07:00
title: "Cross-cutting — thoroughness axis wiring"
status: deferred
from: docs/DESIGN.md#thoroughness-levels
spawned: []
mode: YOLO
project_shape: empty-dream
thoroughness: balanced
stack_layers: [backend]
blocked_by: [a01000]
---

## Goal

Wire the third config axis — `thoroughness` (`send-it` / `balanced` / `thorough`) — through every command that depends on it. Mode and shape already cascade; this plan completes the trio.

## Scope

- `devx.config.yaml → thoroughness` parsing in the config loader (Phase 0 dependency).
- `--thoroughness <level>` per-command override flag.
- Per-spec frontmatter override (`thoroughness: thorough`) honored over project default.
- Per-thoroughness branching in `/devx-plan` (party-mode skip on `send-it`), `/devx-test` (QA Layer 2 cadence), `/devx-learn` (retro concordance threshold).

## Sub-specs to spawn

To be elicited by `/devx-plan` when this plan is claimed.

## Acceptance criteria

- [ ] `/devx-plan --thoroughness send-it "small fix"` skips party-mode for single-surface epics.
- [ ] `/devx-plan --thoroughness thorough` runs advanced-elicitation pre-write.
- [ ] LearnAgent's retro threshold visibly shifts (≥2 on thorough, ≥3 on balanced, ≥5 on send-it).

## Status log

- 2026-04-26T19:30 — Cross-cutting placeholder created

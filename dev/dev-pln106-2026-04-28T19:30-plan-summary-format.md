---
hash: pln106
type: dev
created: 2026-04-28T19:30:00-07:00
title: Phase 8 final-summary Next command block format
from: _bmad-output/planning-artifacts/epic-devx-plan-skill.md
plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md
status: in-progress
blocked_by: [pln102]
branch: feat/dev-pln106
owner: /devx
---

## Goal

Pin the format of `/devx-plan` Phase 8's `Next command:` block so users (and Concierge later) can grep + parse it. Test asserts the format against a 3-epic fixture plan.

## Acceptance criteria

- [ ] Phase 8 emits the block in this exact format:
  ```
  Next command(s), in dependency order:
    /devx <hash-of-first>          # <one-line title>
    /devx <hash-of-second>         # <one-line title>; depends on <hash-of-first>
    ...
  ```
- [ ] When dependency graph has parallel-safe pairs (no edge between siblings), comment annotates `# parallel-safe with <other-hash>`.
- [ ] When all epics done + DEV.md empty, block emits `/devx next  # picks top of DEV.md (currently empty)`.
- [ ] `plan-final-summary-format.test.ts` exercises the format against a fixture plan with 3 epics + 1 parallel pair.
- [ ] `.claude/commands/devx-plan.md` Phase 8 section references this format as the canonical shape.

## Technical notes

- Stable text format enables Concierge (Phase 2) to surface "next runnable" via `devx ask "what should I run next?"` by parsing the last `/devx-plan` final summary.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
- 2026-05-05T10:25 — claimed by /devx; worktree feat/dev-pln106 from main

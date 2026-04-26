---
hash: ini504
type: dev
created: 2026-04-26T19:35:00-07:00
title: Personas + INTERVIEW.md fixed-template seeding
from: _bmad-output/planning-artifacts/epic-init-skill.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
blocked_by: [ini502]
branch: develop/dev-ini504
---

## Goal

Implement `src/lib/init-personas.ts` (4 real + 1 anti-persona seeding from N3 answer) and `src/lib/init-interview.ts` (3 stack-templated INTERVIEW questions from `_devx/templates/init/interview-seed-<stack>.md`).

## Acceptance criteria

- [ ] `init-personas.ts` reads N3 (who-for) answer; if user listed archetypes, writes one `focus-group/personas/persona-<name>.md` per archetype with full skeleton (demographics, goals, frustrations, voice, tech savvy, reactions library, signature red flags, signature delights, anti-features)
- [ ] If user said "you propose," writes 5-template default (4 real + Morgan anti)
- [ ] Anti-persona file is mandatory in either path
- [ ] Caps panel size at 6; if user provided 6+ archetypes, asks to merge or drop one
- [ ] Existing personas never overwritten (touch only if missing)
- [ ] `init-interview.ts` selects right `_devx/templates/init/interview-seed-<stack>.md` for detected stack (python | ts | rust | go | flutter | empty)
- [ ] Writes 3 stack-templated questions to INTERVIEW.md if file is empty (i.e., contains only the empty-state header)
- [ ] Existing INTERVIEW questions never overwritten
- [ ] Vitest covers: archetypes-given / archetypes-default / persona-already-present / INTERVIEW-already-seeded / 6+ archetypes prompt

## Technical notes

- Stack templates are short — just 3 `[ ]`-checkbox questions per file with the question text + "(from /devx-init)" attribution.

## Status log

- 2026-04-26T19:35 — created by /devx-plan

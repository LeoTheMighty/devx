---
name: Jess
archetype: Tinkerer graduating from single-session AI tools
weight: 0.15
created: 2026-04-23
revised: 2026-04-23
source: seeded-at-init
---

## Demographics
- 6 months into daily Claude Code use.
- Has shipped one small thing; wants to ship more.
- Reads changelogs for developer tools for fun.

## Goals with devx
- Get to "the next level" of AI-assisted building without locking in.
- Keep the ability to drop back to raw Claude Code when devx feels wrong.
- Learn by reading — the system should be legible, not magical.

## Frustrations
- Frameworks that colonize her workflow and resist being removed.
- Black-box agents she can't inspect.
- Tools that demand a Discord visit to understand.

## Voice
Curious, skeptical, asks "what happens if I do X" a lot. Will read the docs cover to cover before using anything.

## Tech savvy
High and getting higher. Will read every file under `_bmad/`.

## Reactions library
- **`devx eject` command:** "Critical. If this exists and works, I'll adopt. If not, no."
- **Plain markdown everywhere:** "Yes — I can `grep` my project."
- **BMAD as library not cage:** "Right call. I want to use BMAD primitives directly sometimes."
- **Observability-as-first-class:** "Only if it's optional; not every tinker project has logs."

## Signature red flags
1. Anything that would make it hard to `git log` the system's decisions.
2. Magic that "just works" but can't be explained.
3. Lock-in to a proprietary file format, DSL, or CLI.

## Signature delights
1. Being able to read a devx-generated PRD and understand every line.
2. `devx eject` leaving her with a vanilla BMAD project.
3. Lessons stored as individual memory files she can read, edit, delete.

## Where Jess keeps devx honest
Jess is the persona that enforces our portability/legibility commitments. Any design that fails her test — "can I explain this to another engineer in 2 minutes? can I leave in under an hour?" — is too magical.

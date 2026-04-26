---
name: Dana
archetype: Indie hacker with multiple concurrent projects
weight: 0.20
created: 2026-04-23
revised: 2026-04-23
source: seeded-at-init
---

## Demographics
- 3–5 projects at any given moment, varying maturity (prototype → shipped → maintenance).
- Switches context across projects multiple times per week.
- Monetizes a mix of SaaS, apps, and consulting.

## Goals with devx
- Identical muscle memory across every project.
- A single mobile app that shows the state of all projects at once.
- Not re-explaining her preferences to every project's agents separately.

## Frustrations
- Tools that require per-project re-setup.
- Config drift across projects — "which one did I set this up that way?"
- Context-switching cost when each project has a different agent workflow.

## Voice
Efficient, pragmatic, short patience for ceremony. "Just give me the primitive, I'll compose."

## Tech savvy
High. Runs her own Worker deployments, forks libraries without asking.

## Reactions library
- **Global `~/.claude/commands/devx-*` install:** "Yes. Must be global."
- **Multi-project mobile switcher in v1.5:** "Should be v1. Not v1.5."
- **Global user memory persisting across projects:** "Yes — if I teach devx something about me once, every project should benefit."
- **Per-project `devx.config.yaml`:** "Fine, but the schema must be identical across projects."

## Signature red flags
1. Having to re-answer init questions whose answer is "same as last project."
2. Mobile app that can't switch between projects.
3. CLAUDE.md pollution where learned lessons are duplicated across projects instead of promoted to global.

## Signature delights
1. Fresh `/devx-init` prompting "carry over preferences from your 3 other devx projects?"
2. Mobile app showing unified cross-project inbox.
3. Global-memory promotion of lessons that apply to every project.

## Disagreements with Leonid
- Monorepo support: Dana needs it day 1; Leonid would be fine with v1.5.
- Global vs. per-project memory: Dana wants aggressive global promotion; Leonid wants conservative.

# Focus Group — devx itself

The panel we consult throughout building devx. Dogfood: we use our own subsystem on ourselves.

Last updated: 2026-04-23

| Persona | Archetype | Weight | Primary use | Signature red flag | Signature delight |
|---|---|---|---|---|---|
| Leonid | Solo founder-engineer (primary) | 40% | Shipping real products alone, Flutter + Python, already on Claude Code | Tool demands 2 hours of setup for 1 hour of payoff | 30-minute init-to-first-shipped-feature |
| Dana | Indie hacker, multiple projects | 20% | 3–5 concurrent side projects, wants consistent rails | Per-project config divergence | Same commands across every project |
| Sam | Two-person startup CTO | 20% | Shipping fast with one engineering hire | Needs PM / QA functions the team lacks | Enforced test + promotion discipline without a PM |
| Jess | Tinkerer graduating from AI coding tools | 15% | Used Claude Code for 6 months, ready for orchestration | Too-opinionated framework that colonizes their style | Escape hatch back to raw BMAD / raw Claude Code |
| Morgan (anti-persona) | Enterprise eng lead | 5% | Has a PM, SRE, QA lead, build team | We should NOT optimize for their asks | — |

## Panel dynamics

- **Strongest agreement:** everyone values "no cloud infra" and "files + git as the datastore." That's a locked design principle.
- **Strongest disagreement:** Leonid vs. Dana on monorepo. Leonid wants monorepo config shape in v1.5 for multiple projects; Dana needs it on day 1. Resolution pending (OPEN_QUESTIONS #20).
- **Anti-persona check:** Morgan would ask for multi-tenant auth, RBAC, SSO, hosted dashboards. Any time a proposal moves toward Morgan's needs, flag for scope review.

## Upcoming planned consultations

- Before writing PRD.md — "react to the brief and the six-moment walkthrough."
- Before publishing the `/devx-init` skill — "walk through the conversational init; which question is unclear?"
- Before shipping v0.1 — "open this README on your phone; does it pass the 90-second test?"
